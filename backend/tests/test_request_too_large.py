"""One 429 means "wait", the other means "ask for less". They are not interchangeable.

    Rate limit reached ... Used 703, Requested 765 ... try again in 28.08s
    Request too large ... Limit 1000, Requested 1414 ... reduce max_tokens

The second carries no "try again in" because there is no time at which it would
succeed - a single request may not expect more output than the whole per-minute
allowance. Treating it as the first spent three retries arriving back at the same
refusal, and the caller had timed out by then anyway.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from conftest import install_virtual_clock

from app.core.config import settings
from app.services import llm as llm_module
from app.services.llm import (
    LLMError,
    _cap_ceiling,
    complete_json,
    reset_learned_limits,
    retry_after_seconds,
)
from app.services.rate_limit import reset_buckets

MODEL = "qwen/qwen3.8-27b"

TOO_LARGE = json.dumps(
    {
        "error": {
            "message": (
                "Request too large for model `qwen/qwen3.8-27b` in organization "
                "`org_01m20pqxrvev5rh25wd6cn2y59` service tier `on_demand` on output "
                "tokens per minute (OTPM): Limit 1000, Requested 1414. The request's "
                "expected output tokens exceed the enforced limit; reduce max_tokens "
                "(or the request's expected output) and try again."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
)

TRANSIENT = json.dumps(
    {
        "error": {
            "message": (
                "Rate limit reached for model `qwen/qwen3.8-27b` on output tokens per "
                "minute (OTPM): Limit 1000, Used 703, Requested 765. Please try again "
                "in 28.08s."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
)

ANSWER = {
    "choices": [{"finish_reason": "stop", "message": {"content": '{"decision": "INCLUDE"}'}}],
    "usage": {"completion_tokens": 378, "total_tokens": 1218},
}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    reset_learned_limits()
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_deadline_seconds", 90.0)
    monkeypatch.setattr(settings, "llm_max_output_tokens", 800)
    monkeypatch.setattr(settings, "llm_max_output_ceiling", 6144)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 1000)
    # Budgets off: this file is about the request shape, not about pacing.
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    # A sleep must move the clock, or a bucket waiting on a refill spins forever.
    install_virtual_clock(monkeypatch, llm_module)
    yield
    reset_learned_limits()
    reset_buckets()



def _transport(monkeypatch, handler):
    sent: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return handler(len(sent), sent[-1])

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        llm_module.httpx,
        "AsyncClient",
        lambda *a, **k: real_client(*a, **{**k, "transport": httpx.MockTransport(responder)}),
    )
    return sent


def _call():
    return asyncio.run(complete_json(system_prompt="s", user_prompt="u", model=MODEL))


# --- the cap can never be over the limit in the first place ---------------------------


def test_the_cap_is_bounded_by_the_output_allowance():
    """A request expecting more output than a whole minute allows is refused outright."""
    assert _cap_ceiling() <= settings.llm_output_tokens_per_minute


def test_escalation_cannot_climb_past_the_allowance(monkeypatch):
    """The 6144 ceiling must not let a truncation retry walk into a hard refusal."""
    cap_failure = json.dumps(
        {"error": {"code": "json_validate_failed", "message": "max completion tokens reached"}}
    )

    def handler(n, _payload):
        return httpx.Response(400, text=cap_failure)

    sent = _transport(monkeypatch, handler)
    with pytest.raises(LLMError):
        _call()

    assert max(p["max_tokens"] for p in sent) <= 1000


# --- telling the two 429s apart -------------------------------------------------------


def test_request_too_large_shrinks_the_cap_instead_of_waiting(monkeypatch):
    def handler(n, payload):
        if payload["max_tokens"] > 1000:
            return httpx.Response(429, text=TOO_LARGE)
        return httpx.Response(200, json=ANSWER)

    monkeypatch.setattr(settings, "llm_max_output_tokens", 1600)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)  # nothing clamps it
    sent = _transport(monkeypatch, handler)

    assert _call()["decision"] == "INCLUDE"
    assert sent[0]["max_tokens"] == 1600
    assert sent[1]["max_tokens"] == 1000, "reduced to the limit the provider stated"


def test_the_reduced_cap_is_remembered(monkeypatch):
    """The next paper must not rediscover the refusal at the cost of another call."""

    def handler(n, payload):
        if payload["max_tokens"] > 1000:
            return httpx.Response(429, text=TOO_LARGE)
        return httpx.Response(200, json=ANSWER)

    monkeypatch.setattr(settings, "llm_max_output_tokens", 1600)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    sent = _transport(monkeypatch, handler)

    _call()
    _call()
    assert [p["max_tokens"] for p in sent] == [1600, 1000, 1000]


def test_a_transient_429_still_waits_and_retries(monkeypatch):
    """The other 429 must keep its old behaviour - the cap is not the problem there."""

    def handler(n, _payload):
        return httpx.Response(429, text=TRANSIENT) if n == 1 else httpx.Response(200, json=ANSWER)

    sent = _transport(monkeypatch, handler)
    assert _call()["decision"] == "INCLUDE"
    assert len(sent) == 2
    assert sent[0]["max_tokens"] == sent[1]["max_tokens"], "same request, just later"


def test_the_transient_form_still_yields_its_wait():
    assert retry_after_seconds(httpx.Response(429, text=TRANSIENT)) == pytest.approx(28.08)


def test_the_hard_form_offers_no_wait_to_honour():
    """Which is exactly why it must not be treated as something to wait out."""
    assert retry_after_seconds(httpx.Response(429, text=TOO_LARGE)) is None


def test_an_unshrinkable_request_fails_with_an_actionable_message(monkeypatch):
    """If even the smallest usable cap is refused, say what to change."""
    always = json.dumps(
        {"error": {"message": "Request too large ... OTPM: Limit 10, Requested 800."}}
    )
    _transport(monkeypatch, lambda _n, _p: httpx.Response(429, text=always))

    with pytest.raises(LLMError) as caught:
        _call()
    message = str(caught.value)
    assert "LLM_MAX_OUTPUT_TOKENS" in message
    assert "LLM_OUTPUT_TOKENS_PER_MINUTE" in message


# --- not outlasting the caller ---------------------------------------------------------


def test_the_call_gives_up_before_the_orchestrator_does(monkeypatch):
    """270s of retries behind a 120s HTTP timeout is work completed and then discarded."""
    assert settings.llm_deadline_seconds < settings.agent_http_timeout_seconds

    monkeypatch.setattr(settings, "llm_deadline_seconds", 0.0)  # no time at all
    sent = _transport(monkeypatch, lambda _n, _p: httpx.Response(503, text="upstream down"))

    with pytest.raises(LLMError) as caught:
        _call()

    assert len(sent) == 1, "one attempt, then out of time"
    assert "gave up after" in str(caught.value)
