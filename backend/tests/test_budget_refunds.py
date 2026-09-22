"""A call that produced nothing must cost nothing.

The budget is reserved before a request is sent, because the provider charges max_tokens
the moment it arrives and pacing has to happen in advance (see rate_limit.py). The
reservation was only ever handed back on success, so every failed attempt kept it and
every retry reserved again - and retries are the normal case for a 503 or a transient
429, neither of which runs a model or charges anything.

Measured before the fix: one call that met four 503s took 12178 tokens out of a 200000
token day having produced no output at all. Six of those is a third of the daily budget
spent on nothing, which is most of why Agent 4 "ran out" long before its real usage said
it should.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.core.config import settings
from app.services import llm
from app.services.llm import LLMError, complete_json
from app.services.rate_limit import budget_for, reset_buckets

MODEL = "test/model"
ANSWER = {
    "choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
}


@pytest.fixture
def budget(monkeypatch):
    """A day budget with the other two meters out of the way."""
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 200_000)
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 100_000_000)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day_by_model", "")
    monkeypatch.setattr(settings, "llm_tokens_per_minute_by_model", "")
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute_by_model", "")

    real_sleep = asyncio.sleep

    async def no_wait(_delay, *a, **k):
        await real_sleep(0)

    monkeypatch.setattr(llm.asyncio, "sleep", no_wait)
    yield budget_for(MODEL, 100_000_000, 200_000, 0).day
    reset_buckets()


def _transport(monkeypatch, handler):
    """Route the client at `handler`, which is given the attempt number."""
    calls = {"n": 0}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            calls["n"] += 1
            return handler(calls["n"])

    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda *a, **k: FakeClient())
    return calls


def _spend(day, call):
    day._refill()
    before = day._available
    try:
        call()
    except LLMError:
        pass
    day._refill()
    return before - day._available


def _call():
    return asyncio.run(
        complete_json(system_prompt="s" * 3500, user_prompt="u" * 4300, model=MODEL)
    )


def test_a_rejected_request_costs_nothing(budget, monkeypatch):
    """503 is the provider declining to run the model. It charges for nothing."""
    _transport(monkeypatch, lambda n: httpx.Response(503, text="high demand"))

    spent = _spend(budget, _call)

    assert spent == pytest.approx(0, abs=1), (
        f"{spent:.0f} tokens charged for four rejected requests that ran no model"
    )


def test_a_transport_failure_costs_nothing(budget, monkeypatch):
    """A timeout never reached the provider at all."""

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda *a, **k: FakeClient())

    assert _spend(budget, _call) == pytest.approx(0, abs=1)


def test_a_successful_call_still_costs_what_it_used(budget, monkeypatch):
    """The fix must not hand back budget that was genuinely spent."""
    _transport(monkeypatch, lambda n: httpx.Response(200, json=ANSWER))

    spent = _spend(budget, _call)

    assert spent == pytest.approx(ANSWER["usage"]["total_tokens"], abs=1)


def test_a_retry_that_eventually_succeeds_pays_only_for_the_success(budget, monkeypatch):
    """The common case: one blip, then an answer. Only the answer ran a model."""
    _transport(
        monkeypatch,
        lambda n: httpx.Response(503, text="high demand")
        if n < 3
        else httpx.Response(200, json=ANSWER),
    )

    spent = _spend(budget, _call)

    assert spent == pytest.approx(ANSWER["usage"]["total_tokens"], abs=1)


def test_a_429_still_adopts_the_providers_own_figure(budget, monkeypatch):
    """The refund must not undo resync.

    A 429 body states the real budget, and that figure is authoritative - our own count
    is an estimate and another process may share the key. The refund happens first and
    resync clamps with min() afterwards, so the provider's number wins either way. If
    the order were reversed the refund would add tokens back on top of the truth.
    """
    body = (
        "Rate limit reached for model `test/model` on tokens per day (TPD): "
        "Limit 200000, Used 199000, Requested 900. Please try again in 1m5s."
    )
    _transport(monkeypatch, lambda n: httpx.Response(429, text=body))

    try:
        _call()
    except LLMError:
        pass

    budget._refill()
    assert budget._available <= 1200, (
        f"{budget._available:.0f} tokens left, but the provider said 199000 of 200000 "
        "are used - the refund overwrote its figure"
    )
