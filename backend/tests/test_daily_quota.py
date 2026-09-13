"""A spent daily quota is not an outage, and must not be reported as one.

The 429s here are the tokens-per-day variety, taken from real logs. They differ from the
per-minute kind in two ways that both matter: the wait is quoted in a compound format
("6m35.712s"), and it is far longer than any caller is prepared to sit through. Handling
them as if they were the per-minute kind produced three futile 30-second retries and then
"the verification model is unavailable", which was not true and told the researcher
nothing they could act on.
"""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest

from app.core.config import settings
from app.services import llm as llm_module
from app.services.llm import (
    LLMError,
    complete_json,
    parse_duration,
    reset_learned_limits,
    retry_after_seconds,
    scope_from_body,
)
from app.services.rate_limit import (
    BudgetExhausted,
    ModelBudget,
    TokenBucket,
    budget_for,
    reset_buckets,
)

MODEL = "openai/gpt-oss-120b"
TPD = 200_000

# Verbatim from the logs.
TPD_BODY = json.dumps(
    {
        "error": {
            "message": (
                "Rate limit reached for model `openai/gpt-oss-120b` in organization "
                "`org_01m20pqxrvev5rh25wd6cn2y59` service tier `on_demand` on tokens per "
                "day (TPD): Limit 200000, Used 198516, Requested 2400. Please try again "
                "in 6m35.712s. Need more tokens? Upgrade to Dev Tier today at "
                "https://console.groq.com/settings/billing"
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
)

TPM_BODY = json.dumps(
    {
        "error": {
            "message": (
                "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute "
                "(TPM): Limit 8000, Used 7752, Requested 2588. Please try again in "
                "17.549999999s."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
)

GOOD_ANSWER = {
    "choices": [
        {"finish_reason": "stop", "message": {"content": '{"decision": "INCLUDE"}'}}
    ],
    "usage": {"total_tokens": 900},
}


# --- parsing the provider's own words ----------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("17.549999999s", 17.549999999),
        ("6m35.712s", 395.712),
        ("2m19.536s", 139.536),
        ("1h2m3s", 3723.0),
        ("45s", 45.0),
        ("3m", 180.0),
    ],
)
def test_compound_durations_are_parsed(text, expected):
    """A seconds-only pattern returned no match here, and the caller guessed instead."""
    assert parse_duration(text) == pytest.approx(expected)


def test_retry_after_reads_a_compound_duration_from_a_real_body():
    response = httpx.Response(429, text=TPD_BODY)
    assert retry_after_seconds(response) == pytest.approx(395.712)


def test_unparseable_duration_is_none_not_zero():
    """Zero would mean "retry now", which is the opposite of what is being said."""
    assert parse_duration("later") is None


def test_scope_distinguishes_the_two_limits():
    assert scope_from_body(TPD_BODY) == "day"
    assert scope_from_body(TPM_BODY) == "minute"
    # An error that says nothing about scope is treated as the faster, recoverable one.
    assert scope_from_body('{"error":{"message":"overloaded"}}') == "minute"


# --- the daily bucket ---------------------------------------------------------------


def test_daily_bucket_refills_at_the_observed_rate():
    """200000/86400 predicts 69.4 tokens per 30s; the logs showed 71, 70 and 72."""
    bucket = TokenBucket(TPD, period_seconds=86_400.0)
    bucket.resync(limit=TPD, used=TPD)  # fully spent
    assert bucket.wait_for(69.4) == pytest.approx(30.0, abs=0.5)


def test_a_call_must_fit_both_limits():
    """Room in the minute means nothing if the day is gone - the old blind spot."""
    budget = ModelBudget(tokens_per_minute=8000, tokens_per_day=TPD)
    budget.day.resync(limit=TPD, used=198_516)  # 1484 left, as in the logs

    with pytest.raises(BudgetExhausted) as caught:
        asyncio.run(budget.acquire(2400, max_wait=75.0))

    assert caught.value.scope == "day"
    # (2400 - 1484) / (200000/86400) = 395.7s, the figure Groq quoted.
    assert caught.value.wait_seconds == pytest.approx(395.7, abs=1.0)


def test_an_affordable_minute_wait_is_still_waited_for():
    """Failing fast must not leak into the per-minute case, which pacing handles."""
    budget = ModelBudget(tokens_per_minute=8000, tokens_per_day=0)
    real_sleep, real_monotonic = asyncio.sleep, time.monotonic
    now = real_monotonic()

    async def fake_sleep(delay, *a, **k):
        nonlocal now
        now += delay
        await real_sleep(0)

    asyncio.sleep, time.monotonic = fake_sleep, lambda: now
    try:
        waited = asyncio.run(_two_calls(budget))
    finally:
        asyncio.sleep, time.monotonic = real_sleep, real_monotonic

    assert 0 < waited <= 75.0


async def _two_calls(budget):
    await budget.acquire(7000, max_wait=75.0)
    return await budget.acquire(2000, max_wait=75.0)


# --- what the caller sees -------------------------------------------------------------


@pytest.fixture
def _isolate(monkeypatch):
    reset_learned_limits()
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 8000)
    monkeypatch.setattr(settings, "llm_tokens_per_day", TPD)
    monkeypatch.setattr(settings, "llm_max_wait_seconds", 75.0)
    _install_virtual_clock(monkeypatch)
    yield
    reset_learned_limits()
    reset_buckets()


def _install_virtual_clock(monkeypatch):
    """Make sleeping advance the clock instead of the wall.

    Stubbing sleep alone is not enough and is worse than doing nothing: the bucket waits
    in a loop until its own clock says the tokens have refilled, so a no-op sleep leaves
    the condition unchanged and turns a 57-second wait into a 57-second busy-spin.
    """
    real_sleep = asyncio.sleep
    now = time.monotonic()

    async def fake_sleep(delay, *args, **kwargs):
        nonlocal now
        now += max(0.0, float(delay))
        await real_sleep(0)

    monkeypatch.setattr(llm_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(time, "monotonic", lambda: now)


def _transport(monkeypatch, handler):
    sent: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return handler(len(sent))

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        llm_module.httpx,
        "AsyncClient",
        lambda *a, **k: real_client(*a, **{**k, "transport": httpx.MockTransport(responder)}),
    )
    return sent


# Prompt sizes matter to these tests: the reservation is prompt + cap, and it is what
# decides whether a call still fits in what is left of the day. A toy prompt would fit
# where a real verification does not, and would test a situation that cannot occur.
REAL_SYSTEM_PROMPT = "x" * 3000
REAL_USER_PROMPT = "y" * 2500


def _call():
    return asyncio.run(
        complete_json(
            system_prompt=REAL_SYSTEM_PROMPT, user_prompt=REAL_USER_PROMPT, model=MODEL
        )
    )


def test_daily_429_fails_immediately_instead_of_retrying(_isolate, monkeypatch):
    """Three retries inside a 6m35s wait can only arrive at the same failure, later."""
    sent = _transport(monkeypatch, lambda _n: httpx.Response(429, text=TPD_BODY))

    with pytest.raises(LLMError) as caught:
        _call()

    assert len(sent) == 1, "must not burn the remaining attempts on a known-hopeless wait"
    message = str(caught.value)
    assert "daily token quota" in message
    assert "7 minutes" in message  # 6m35.712s, reported to the nearest minute
    assert "not an outage" in message


def test_the_daily_429_teaches_the_budget_so_the_next_paper_fails_instantly(
    _isolate, monkeypatch
):
    """A batch must not send 50 doomed requests to discover the same spent quota."""
    sent = _transport(monkeypatch, lambda _n: httpx.Response(429, text=TPD_BODY))

    with pytest.raises(LLMError):
        _call()
    with pytest.raises(LLMError) as second:
        _call()

    # The second paper never reached the network - the budget already knew.
    assert len(sent) == 1
    assert "daily token quota" in str(second.value)


def test_a_minute_429_still_retries(_isolate, monkeypatch):
    """The recoverable case must keep recovering."""

    def handler(n):
        return httpx.Response(429, text=TPM_BODY) if n == 1 else httpx.Response(200, json=GOOD_ANSWER)

    sent = _transport(monkeypatch, handler)
    assert _call()["decision"] == "INCLUDE"
    assert len(sent) == 2


def test_budget_can_be_turned_off_entirely(_isolate, monkeypatch):
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    assert budget_for(MODEL, 0, 0) is None
    _transport(monkeypatch, lambda _n: httpx.Response(200, json=GOOD_ANSWER))
    assert _call()["decision"] == "INCLUDE"
