"""LLM client used by the Verification Agent.

Groq exposes the OpenAI chat-completions API, so this stays provider-agnostic: point
LLM_BASE_URL elsewhere and everything below still works. Other agents are free to reuse
it, but nothing here is specific to verification.

Three mechanisms keep calls inside the provider's limits, and they solve different
problems. Confusing them is how this module previously traded one failure for another.

* app/services/rate_limit.py paces calls *before* they are sent, against a local model
  of the provider's token budget. This is what prevents 429s, because a token budget is
  arithmetic we can do in advance rather than a condition we have to discover.
* The output cap escalates when an answer does not fit (see _escalated_cap). gpt-oss
  models spend the completion budget on reasoning before they write anything, so the cap
  a paper needs is not knowable up front - it is discovered, once, and then remembered.
* The retry loop is the safety net for what neither of those can predict - a burst we
  under-estimated, or another process spending the same key.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from typing import Any

import httpx

from app.core.config import settings
from app.services.rate_limit import BudgetExhausted, budget_for, estimate_tokens

logger = logging.getLogger(__name__)

# Transient upstream conditions worth another attempt; anything else fails fast.
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}

# Groq reports the exact wait for a rate limit, either in Retry-After or in the error
# prose. Honouring it matters: its budgets refill continuously, so a fixed 1s/2s backoff
# retries while still throttled and burns the attempt for nothing.
#
# The duration is compound once the wait passes a minute - "6m35.712s", not "395.712s" -
# and a seconds-only pattern does not fail loudly on that, it just returns no match. The
# backoff then silently falls back to its own guess: this module spent three attempts
# retrying after 30s against a limit that had told it, in the body, to wait 6m35s.
_RETRY_AFTER_IN_BODY = re.compile(
    r"try again in ((?:\d+(?:\.\d+)?[hms])+)", re.IGNORECASE
)
_DURATION_PART = re.compile(r"(\d+(?:\.\d+)?)([hms])", re.IGNORECASE)
_UNIT_SECONDS = {"h": 3600.0, "m": 60.0, "s": 1.0}

# The same body states the budget itself, and which of several budgets ran out. Reading
# both lets the local model correct itself against the provider's own figures, and
# correct the right one: a minute's quota and a day's are very different news.
_LIMIT_IN_BODY = re.compile(r"Limit (\d+)", re.IGNORECASE)
_USED_IN_BODY = re.compile(r"Used (\d+)", re.IGNORECASE)

# The provider meters several different things and says which in the same sentence:
# "tokens per minute (TPM)", "tokens per day (TPD)", "output tokens per minute (OTPM)".
# The qualifier is load-bearing. Matching only "tokens per minute" reads an OTPM refusal
# as a TPM one and resyncs the total-token bucket to the output limit - so a 1000-token
# output cap silently became a 1000-token *total* cap, and nothing could fit afterwards.
_SCOPE_IN_BODY = re.compile(
    r"(?:(output|input|completion|prompt)\s+)?tokens per (minute|day)", re.IGNORECASE
)

# A cap, so a hostile or mistaken Retry-After cannot stall a request indefinitely.
_MAX_BACKOFF_SECONDS = 30.0

# In JSON mode the provider does not return a truncated answer for us to notice - it
# rejects the whole call with a 400. So a cap that was too small arrives looking like a
# malformed request, which is why this needs matching by code rather than by status.
_JSON_VALIDATE_FAILED = "json_validate_failed"

# The provider returns 429 for two conditions that need opposite handling, and only the
# wording tells them apart:
#
#   "Rate limit reached ... Used 703, Requested 765 ... try again in 28.08s"
#       Transient. The budget refills; waiting works.
#   "Request too large ... Limit 1000, Requested 1414 ... reduce max_tokens"
#       Permanent for this request as written, and it carries no "try again in" because
#       there is no time at which it would succeed: one request may never expect more
#       output than the entire per-minute allowance. Retrying is pure waste; the cap has
#       to come down instead.
_REQUEST_TOO_LARGE = "request too large"

# The largest cap a model needed in this process, per model. A cap that was too small
# for one paper is usually too small for the next one too, so the discovery is kept
# rather than repeated: without this, every long paper pays for its own failed call.
_learned_cap: dict[str, int] = {}

# Caps the provider has actively refused as too large. Unlike _learned_cap these are an
# upper bound rather than a lower one, and escalation must not climb back past them.
_forced_cap: dict[str, int] = {}

# Below this an answer cannot be complete, so shrinking further is not a fix.
_MIN_USABLE_CAP = 256

# The largest share of the per-minute output allowance one request may reserve. Well
# under 1.0 so several calls can be in flight against the same minute.
_CAP_SHARE_OF_OUTPUT_LIMIT = 0.5

# What each model's answers actually cost in completion tokens, as a running average.
# The output-per-minute limit is metered on real output, not on the max_tokens ceiling -
# the provider's own OTPM refusal asked for 162 tokens against a 1600 cap - so reserving
# the cap against it would throttle to a fraction of the real rate. Measured instead.
_output_estimate: dict[str, float] = {}

# Models that rejected reasoning_effort. Not every provider behind this OpenAI-shaped
# API supports it, and an optional parameter should not be able to break the client, so
# it is dropped on first refusal and not sent again.
_no_reasoning_effort: set[str] = set()


class LLMError(RuntimeError):
    """The model could not be reached, or did not return usable JSON."""


class LLMQuotaExhausted(LLMError):
    """The account's token budget is spent - not an outage, and not a retry away.

    Separate from LLMError because the two need opposite handling everywhere above
    this module. An outage is transient, nobody's fault, and safe to describe in the
    vague terms an error page uses; a spent quota has a known cause, a known reset
    time, and an owner who can act on it. Collapsing them loses exactly the
    information the researcher needs.
    """

    def __init__(self, message: str, *, scope: str, wait_seconds: float) -> None:
        self.scope = scope
        self.wait_seconds = wait_seconds
        super().__init__(message)


def reset_learned_limits() -> None:
    """Forget what was learned about caps, output sizes and optional parameters."""
    _learned_cap.clear()
    _forced_cap.clear()
    _no_reasoning_effort.clear()
    _output_estimate.clear()


def _expected_output(model: str, cap: int) -> float:
    """How many completion tokens to reserve for the next call to this model.

    Seeded from config and then measured, with headroom: under-reserving buys a 429,
    which costs far more than the throughput a slightly generous reservation gives up.
    Never more than the cap, since the model cannot exceed it.
    """
    seen = _output_estimate.get(model)
    if seen is None:
        return float(min(cap, settings.llm_expected_output_tokens))
    return float(min(cap, seen * 1.3))


def _record_output(model: str, completion_tokens: float) -> None:
    """Fold one observation into the running average (EMA, weighted to the recent)."""
    if completion_tokens <= 0:
        return
    previous = _output_estimate.get(model)
    _output_estimate[model] = (
        completion_tokens if previous is None else previous * 0.7 + completion_tokens * 0.3
    )


async def complete_json(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Call the chat model in JSON mode and return the parsed object.

    Temperature defaults to 0: two verification runs over the same paper should not
    disagree with each other, or the verification layer is just noise.
    """
    if not settings.llm_api_key:
        raise LLMError("LLM_API_KEY is not set - the Verification Agent cannot run.")

    resolved_model = model or settings.llm_model
    # Three bounds, and the tightest wins: what one request may ask for, what this
    # provider has already refused for this model, and the configured ceiling.
    ceiling = min(_cap_ceiling(), _forced_cap.get(resolved_model, _cap_ceiling()))
    requested_cap = (
        settings.llm_max_output_tokens if max_tokens is None else max_tokens
    )
    # Start from whatever this model has already been shown to need, and never above
    # what one request is allowed to ask for.
    cap = min(max(requested_cap, _learned_cap.get(resolved_model, 0)), ceiling)

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    budget = budget_for(
        resolved_model,
        settings.llm_tokens_per_minute,
        settings.llm_tokens_per_day,
        settings.llm_output_tokens_per_minute,
    )

    attempts = 0
    last_error = "unknown error"
    # Retries and provider-requested waits compound, and unbounded they outlast the
    # caller: /api/verify could spend 270s on four attempts while the orchestrator gave
    # up at 120s, so the work was completed and then thrown away by a ReadTimeout. Stop
    # while someone is still listening.
    deadline = time.monotonic() + settings.llm_deadline_seconds

    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        for attempt in range(settings.llm_max_retries + 1):
            attempts += 1
            requested_wait: float | None = None
            # Set when the failure tells us how to fix the request. Retrying then is not
            # hoping for a different outcome from the same call - it is a different call,
            # so it goes straight back out without a backoff it does not need.
            adjusted = False

            payload: dict[str, Any] = {
                "model": resolved_model,
                "temperature": temperature,
                "max_tokens": cap,
                "response_format": {"type": "json_object"},
                "messages": messages,
            }
            effort = settings.reasoning_effort_for(resolved_model)
            if effort and resolved_model not in _no_reasoning_effort:
                # Reasoning tokens are charged to the completion cap before a single
                # character of JSON is written, so this is what makes a modest cap safe.
                payload["reasoning_effort"] = effort

            estimated = estimate_tokens(messages, cap)
            expected_output = _expected_output(resolved_model, cap)
            if budget is not None:
                # Wait for room in the budget rather than spending a network round trip
                # on a call the provider is going to reject anyway - and give up rather
                # than wait past the point where the caller has stopped listening.
                # Bounded by what is left of the deadline, not just by the configured
                # maximum: a 75s wait for budget followed by a 45s call reaches exactly
                # the caller's 120s timeout, which is how a paced call still came back
                # as a bare ReadTimeout with all of its work thrown away.
                remaining = deadline - time.monotonic()
                try:
                    waited = await budget.acquire(
                        estimated,
                        output_tokens=expected_output,
                        max_wait=min(settings.llm_max_wait_seconds, max(0.0, remaining)),
                    )
                except BudgetExhausted as exc:
                    raise LLMQuotaExhausted(
                        _quota_message(resolved_model, exc),
                        scope=exc.scope,
                        wait_seconds=exc.wait_seconds,
                    ) from exc
                if waited > 0:
                    logger.debug(
                        "Paced %s call: waited %.1fs for ~%.0f tokens of budget.",
                        resolved_model,
                        waited,
                        estimated,
                    )

            try:
                response = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"request failed: {exc}"
            else:
                if response.status_code == 200:
                    body = response.json()
                    # We reserved the whole cap; the model rarely uses all of it. Hand
                    # the difference back so pacing reflects real consumption.
                    completion = _completion_tokens(body)
                    if completion is not None:
                        _record_output(resolved_model, completion)
                    if budget is not None:
                        budget.refund(
                            estimated - _used_tokens(body, estimated),
                            expected_output - (completion if completion is not None else 0.0),
                        )
                    if _was_truncated(body):
                        raised = _escalated_cap(resolved_model, cap, ceiling)
                        if raised is not None:
                            cap, adjusted = raised, True
                            last_error = "the answer was cut off at max_tokens"
                        else:
                            raise LLMError(_cap_exhausted_message(cap))
                    else:
                        return _parse_choice(body)
                else:
                    # The body carries the provider's reason (unknown model, quota, ...).
                    # Keep it for the error message; never log the Authorization header.
                    last_error = f"HTTP {response.status_code}: {response.text[:400]}"

                    if _rejected_reasoning_effort(response):
                        # An optional tuning parameter must never be the thing that
                        # fails a call. Drop it for this model and send the same request.
                        _no_reasoning_effort.add(resolved_model)
                        logger.info(
                            "%s does not accept reasoning_effort; continuing without it.",
                            resolved_model,
                        )
                        adjusted = True
                    elif _is_request_too_large(response):
                        # Not a wait. The request as written can never be accepted, so
                        # it is rewritten smaller and sent again straight away.
                        allowed, _ = budget_from_body(response.text)
                        reduced = _reduced_cap(resolved_model, cap, allowed)
                        if reduced is None:
                            raise LLMError(_too_large_message(resolved_model, cap, allowed))
                        cap, adjusted = reduced, True
                    elif _is_output_cap_failure(response):
                        raised = _escalated_cap(resolved_model, cap, ceiling)
                        if raised is None:
                            raise LLMError(_cap_exhausted_message(cap))
                        cap, adjusted = raised, True
                    elif response.status_code not in _RETRYABLE_STATUS:
                        break
                    else:
                        requested_wait = retry_after_seconds(response)
                        if response.status_code == 429:
                            scope = scope_from_body(response.text)
                            if budget is not None:
                                limit, used = budget_from_body(response.text)
                                budget.resync(scope=scope, limit=limit, used=used)
                            # Retrying inside a wait we have been told we cannot afford
                            # just spends the remaining attempts to arrive at the same
                            # failure a minute later, with a misleading reason attached.
                            if (requested_wait or 0.0) > settings.llm_max_wait_seconds:
                                wait = requested_wait or 0.0
                                raise LLMQuotaExhausted(
                                    _quota_message(
                                        resolved_model, BudgetExhausted(scope, wait)
                                    ),
                                    scope=scope,
                                    wait_seconds=wait,
                                )

            if attempt >= settings.llm_max_retries:
                break
            if adjusted:
                # A rewritten request costs nothing extra in time, but it still has to
                # fit inside the deadline like any other attempt.
                if time.monotonic() >= deadline:
                    break
                continue

            # Wait at least as long as the provider asked, never less. The jitter matters
            # as much as the delay: sibling calls in a batch are rejected within
            # milliseconds of each other, and without it they would all wake at the same
            # instant and recreate the burst that got them rejected.
            backoff = max(2**attempt, requested_wait or 0.0)
            backoff = min(backoff, _MAX_BACKOFF_SECONDS) + random.uniform(0, 1.0)
            if time.monotonic() + backoff >= deadline:
                last_error = (
                    f"{last_error} (gave up after {settings.llm_deadline_seconds:.0f}s "
                    "rather than outlast the caller)"
                )
                break
            logger.warning("LLM call failed (%s); retrying in %.1fs", last_error, backoff)
            await asyncio.sleep(backoff)

    raise LLMError(f"LLM call failed after {attempts} attempt(s). {last_error}")


def _cap_ceiling() -> int:
    """The largest max_tokens any single request may carry.

    Bounded by the per-minute output allowance as well as by the configured ceiling: a
    request whose expected output exceeds the whole minute's budget is refused outright
    rather than queued, so escalating past that point turns a slow call into a dead one.
    """
    ceiling = max(settings.llm_max_output_tokens, settings.llm_max_output_ceiling)
    per_minute = settings.llm_output_tokens_per_minute
    if per_minute > 0:
        # A fraction, not the whole allowance. The provider derives a request's expected
        # output from max_tokens, so a cap equal to the limit means one request reserves
        # the entire minute and can only ever start against a completely idle bucket -
        # "Used 2, Requested 1000 ... try again" with nothing else running at all.
        shared = int(per_minute * _CAP_SHARE_OF_OUTPUT_LIMIT)
        # ...but never below the cap every call already starts at. Under that, the first
        # request opens at the ceiling, so the first truncation has nowhere to escalate
        # to and fails immediately with a message naming a ceiling nobody configured.
        # A too-low LLM_OUTPUT_TOKENS_PER_MINUTE then reads as "the model is unavailable"
        # rather than as the misconfiguration it is, which is exactly how a 1000 OTPM
        # default silently capped every chat answer at 500 tokens.
        if shared < settings.llm_max_output_tokens:
            logger.warning(
                "LLM_OUTPUT_TOKENS_PER_MINUTE=%d allows one request only %d output "
                "tokens, below LLM_MAX_OUTPUT_TOKENS=%d. Holding the ceiling at %d; "
                "raise the per-minute allowance to match your plan.",
                per_minute,
                shared,
                settings.llm_max_output_tokens,
                settings.llm_max_output_tokens,
            )
        ceiling = min(ceiling, max(shared, settings.llm_max_output_tokens))
    return max(ceiling, _MIN_USABLE_CAP)


def _reduced_cap(model: str, cap: int, allowed: float | None) -> int | None:
    """Shrink the output cap to something the provider will accept, or None if we cannot.

    The provider states the limit it enforced, so the new cap comes from its own figure
    rather than from halving blindly. It is remembered against the model so the next
    paper does not rediscover it.
    """
    target = int(allowed) if allowed and allowed > 0 else cap // 2
    reduced = max(1, min(target, cap - 1))
    if reduced >= cap or reduced < _MIN_USABLE_CAP:
        return None
    _forced_cap[model] = reduced
    _learned_cap[model] = min(_learned_cap.get(model, reduced), reduced)
    logger.info(
        "%s refused an output cap of %d; retrying at %d and keeping that.",
        model,
        cap,
        reduced,
    )
    return reduced


def _too_large_message(model: str, cap: int, allowed: float | None) -> str:
    limit = f"{allowed:.0f}" if allowed else "its per-minute output allowance"
    return (
        f"{model} refuses a request expecting {cap} output tokens: one request may not "
        f"exceed {limit}. Lower LLM_MAX_OUTPUT_TOKENS, or raise "
        "LLM_OUTPUT_TOKENS_PER_MINUTE if your plan allows more."
    )


def _escalated_cap(model: str, cap: int, ceiling: int) -> int | None:
    """Double the output cap, or None if it is already at the ceiling.

    The new cap is remembered against the model, so the next paper starts where this one
    ended up instead of rediscovering the same limit at the cost of another failed call.
    """
    ceiling = min(ceiling, _forced_cap.get(model, ceiling))
    if cap >= ceiling:
        return None
    raised = min(cap * 2, ceiling)
    _learned_cap[model] = max(_learned_cap.get(model, 0), raised)
    logger.info(
        "%s ran out of completion budget at %d tokens; retrying at %d.", model, cap, raised
    )
    return raised


def _quota_message(model: str, exc: BudgetExhausted) -> str:
    """Say which quota ran out and when it returns - never "the model is unavailable".

    A spent daily quota is not an outage and not something a retry fixes. Reporting it
    as one sends the researcher looking for a fault that does not exist, while the real
    answer - wait, or raise the limit - goes unsaid.
    """
    wait = exc.wait_seconds
    when = f"{wait / 60:.0f} minutes" if wait >= 90 else f"{wait:.0f} seconds"
    if exc.scope == "day":
        return (
            f"The daily token quota for {model} is spent; it has room again in about "
            f"{when}. This is a quota, not an outage - screening decisions already made "
            "are unaffected. Raise LLM_TOKENS_PER_DAY if your plan allows more, move "
            "Agent 4 to another model, or re-run the remaining papers tomorrow."
        )
    return (
        f"The per-minute token budget for {model} needs about {when}, longer than this "
        "request can wait. Lower VERIFY_BATCH_CONCURRENCY, or raise LLM_MAX_WAIT_SECONDS "
        "if the caller can wait longer."
    )


def _cap_exhausted_message(cap: int) -> str:
    return (
        f"The model could not produce complete JSON within {cap} output tokens, the "
        "configured ceiling. Raise LLM_MAX_OUTPUT_CEILING, set LLM_REASONING_EFFORT=low "
        "so less of the budget is spent on reasoning, or shorten the prompt."
    )


def _is_request_too_large(response: httpx.Response) -> bool:
    """A 429 that no amount of waiting fixes - the request itself is over the limit."""
    if response.status_code != 429:
        return False
    return _REQUEST_TOO_LARGE in response.text[:600].lower()


def _is_output_cap_failure(response: httpx.Response) -> bool:
    """Is this the provider refusing the call because the answer did not fit?

    In JSON mode Groq returns 400 json_validate_failed rather than a truncated 200, so
    this is a request error in shape but an output-length problem in substance - and the
    two need opposite handling, since only one of them is fixed by trying again.
    """
    if response.status_code != 400:
        return False
    return _JSON_VALIDATE_FAILED in response.text[:600]


def _rejected_reasoning_effort(response: httpx.Response) -> bool:
    """Did the provider refuse the call because it does not know reasoning_effort?"""
    if response.status_code not in (400, 422):
        return False
    body = response.text[:600]
    return "reasoning_effort" in body and _JSON_VALIDATE_FAILED not in body


def retry_after_seconds(response: httpx.Response) -> float | None:
    """How long the provider asked us to wait, from the header or the error prose."""
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            # The HTTP-date form of Retry-After; rare here, and the body usually
            # carries the same number in a form we can read.
            pass

    match = _RETRY_AFTER_IN_BODY.search(response.text[:400])
    if match:
        return parse_duration(match.group(1))
    return None


def parse_duration(text: str) -> float | None:
    """Seconds from a compound duration such as "17.55s", "6m35.712s" or "1h2m3s"."""
    total = 0.0
    found = False
    for amount, unit in _DURATION_PART.findall(text):
        try:
            total += float(amount) * _UNIT_SECONDS[unit.lower()]
        except (ValueError, KeyError):
            return None
        found = True
    return total if found else None


def budget_from_body(text: str) -> tuple[float | None, float | None]:
    """The provider's own (limit, used) figures out of a 429 message, if stated."""
    head = text[:400]
    limit_match = _LIMIT_IN_BODY.search(head)
    used_match = _USED_IN_BODY.search(head)
    limit = float(limit_match.group(1)) if limit_match else None
    used = float(used_match.group(1)) if used_match else None
    return limit, used


def scope_from_body(text: str) -> str:
    """Which budget the provider says ran out: "output", "day", or "minute".

    Defaults to "minute" when the message does not say, because that is the limit that
    recovers fastest and so the least damaging thing to assume.
    """
    match = _SCOPE_IN_BODY.search(text[:400])
    if not match:
        return "minute"
    qualifier, period = match.group(1), match.group(2).lower()
    if qualifier and qualifier.lower() in {"output", "completion"} and period == "minute":
        return "output"
    return "day" if period == "day" else "minute"


def _completion_tokens(body: dict[str, Any]) -> float | None:
    """What the answer itself cost, which is what the output-per-minute limit meters."""
    usage = body.get("usage")
    if isinstance(usage, dict):
        value = usage.get("completion_tokens")
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def _used_tokens(body: dict[str, Any], fallback: float) -> float:
    """What the call actually cost, per the response's usage block."""
    usage = body.get("usage")
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        if isinstance(total, (int, float)) and total > 0:
            return float(total)
    return fallback


def _parse_choice(body: dict[str, Any]) -> dict[str, Any]:
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected response shape from the LLM: {str(body)[:300]}") from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMError(f"LLM did not return valid JSON: {content[:300]}") from exc

    if not isinstance(parsed, dict):
        raise LLMError(f"LLM returned {type(parsed).__name__}, expected a JSON object.")
    return parsed


def _was_truncated(body: dict[str, Any]) -> bool:
    """The other shape of the same problem: a 200 that stopped at the cap."""
    try:
        return body["choices"][0].get("finish_reason") == "length"
    except (KeyError, IndexError, TypeError):
        return False
