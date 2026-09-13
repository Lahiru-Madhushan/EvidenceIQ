"""Output tokens are metered on their own, and the qualifier in the message matters.

Groq limits output tokens per minute (OTPM) separately from total tokens per minute
(TPM), and says which in the same sentence: "on output tokens per minute (OTPM): Limit
1000". Reading that as a TPM refusal did active harm - it resynced the total-token
bucket to the output limit, rewriting an 8000-token minute budget as a 1000-token one,
after which no call could fit at all.
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
    budget_from_body,
    complete_json,
    reset_learned_limits,
    retry_after_seconds,
    scope_from_body,
)
from app.services.rate_limit import ModelBudget, TokenBucket, reset_buckets

MODEL = "qwen/qwen3.8-27b"

# Verbatim from the logs.
OTPM_BODY = json.dumps(
    {
        "error": {
            "message": (
                "Rate limit reached for model `qwen/qwen3.8-27b` in organization "
                "`org_01m20pqxrvev5rh25wd6cn2y59` service tier `on_demand` on output "
                "tokens per minute (OTPM): Limit 1000, Used 895, Requested 162. Please "
                "try again in 3.42s."
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
                "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7752, "
                "Requested 2588. Please try again in 17.5s."
            )
        }
    }
)

TPD_BODY = json.dumps(
    {"error": {"message": "on tokens per day (TPD): Limit 200000, Used 199666."}}
)


def _answer(completion: int, total: int):
    return {
        "choices": [
            {"finish_reason": "stop", "message": {"content": '{"decision": "INCLUDE"}'}}
        ],
        "usage": {"completion_tokens": completion, "total_tokens": total},
    }


# --- reading the message --------------------------------------------------------------


@pytest.mark.parametrize(
    "body,expected",
    [
        (OTPM_BODY, "output"),
        (TPM_BODY, "minute"),
        (TPD_BODY, "day"),
        ('{"error":{"message":"overloaded"}}', "minute"),
    ],
)
def test_the_qualifier_selects_the_right_budget(body, expected):
    assert scope_from_body(body) == expected


def test_the_otpm_message_still_yields_its_numbers_and_wait():
    assert budget_from_body(OTPM_BODY) == (1000.0, 895.0)
    assert retry_after_seconds(httpx.Response(429, text=OTPM_BODY)) == pytest.approx(3.42)


# --- keeping the buckets apart --------------------------------------------------------


def test_an_output_limit_never_rewrites_the_total_limit():
    """The damage the misread caused: 8000 TPM silently became 1000."""
    budget = ModelBudget(tokens_per_minute=8000, tokens_per_day=0, output_tokens_per_minute=1000)

    budget.resync(scope="output", limit=1000, used=895)

    assert budget.minute.capacity == 8000, "the total budget must be untouched"
    assert budget.output.capacity == 1000
    # And a normal-sized call still fits, which it did not before.
    assert budget.minute.wait_for(2440) == 0.0


def test_a_call_must_fit_the_output_budget_too():
    """Room in the minute means nothing if the output allowance is spent."""
    budget = ModelBudget(tokens_per_minute=8000, tokens_per_day=0, output_tokens_per_minute=1000)
    budget.output.resync(limit=1000, used=895)  # 105 left, as in the logs

    from app.services.rate_limit import BudgetExhausted

    # 162 output tokens wanted, 105 available: a short wait, so it is waited for.
    assert budget.output.wait_for(162) == pytest.approx((162 - 105) * 60 / 1000, abs=0.01)

    # But a request for the whole minute's output at once is refused rather than queued.
    with pytest.raises(BudgetExhausted) as caught:
        asyncio.run(budget.acquire(2000, output_tokens=1000, max_wait=5.0))
    assert caught.value.scope == "output"


def test_output_pacing_holds_the_real_ceiling():
    """1000 output tokens a minute over ~380-token answers is 2.6 papers a minute."""
    bucket = TokenBucket(1000)
    real_sleep, real_monotonic = asyncio.sleep, time.monotonic
    now = real_monotonic()

    async def fake_sleep(delay, *a, **k):
        nonlocal now
        now += delay
        await real_sleep(0)

    async def five_papers():
        for _ in range(5):
            await bucket.acquire(380)

    start = now
    asyncio.sleep, time.monotonic = fake_sleep, lambda: now
    try:
        asyncio.run(five_papers())
    finally:
        asyncio.sleep, time.monotonic = real_sleep, real_monotonic

    # 5 x 380 = 1900 output tokens; 900 more than the bucket holds, at 1000/60 per second.
    assert now - start == pytest.approx(900 * 60 / 1000, abs=0.5)


# --- measuring what answers really cost ------------------------------------------------


@pytest.fixture
def _isolate(monkeypatch):
    reset_learned_limits()
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 2)
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_expected_output_tokens", 500)
    monkeypatch.setattr(settings, "llm_max_output_tokens", 1600)
    yield
    reset_learned_limits()
    reset_buckets()


def _transport(monkeypatch, response):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        llm_module.httpx,
        "AsyncClient",
        lambda *a, **k: real_client(
            *a, **{**k, "transport": httpx.MockTransport(lambda _r: response())}
        ),
    )


def test_the_output_estimate_is_measured_not_assumed(_isolate, monkeypatch):
    """The cap is 1600 but answers cost ~378; reserving the cap would throttle to a crawl."""
    _transport(monkeypatch, lambda: httpx.Response(200, json=_answer(378, 1218)))

    assert llm_module._expected_output(MODEL, 1600) == 500  # the configured seed

    asyncio.run(complete_json(system_prompt="s", user_prompt="u", model=MODEL))

    # After one real answer the estimate tracks it, with headroom, not the 1600 cap.
    estimate = llm_module._expected_output(MODEL, 1600)
    assert 450 < estimate < 520, estimate
    assert estimate < 1600


def test_the_estimate_never_exceeds_the_cap(_isolate, monkeypatch):
    _transport(monkeypatch, lambda: httpx.Response(200, json=_answer(1500, 3000)))
    asyncio.run(complete_json(system_prompt="s", user_prompt="u", model=MODEL))
    assert llm_module._expected_output(MODEL, 1600) == 1600  # 1500 * 1.3 clamped


def test_a_missing_usage_block_does_not_poison_the_estimate(_isolate, monkeypatch):
    body = {"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]}
    _transport(monkeypatch, lambda: httpx.Response(200, json=body))
    asyncio.run(complete_json(system_prompt="s", user_prompt="u", model=MODEL))
    assert llm_module._expected_output(MODEL, 1600) == 500  # still the seed
