"""The token budget is only worth having if it holds under the case that broke us.

The failing scenario was concrete: four concurrent verifications, each reserving ~2900
tokens, against an 8000 TPM bucket. These tests reproduce that shape rather than testing
the bucket in the abstract.

The bucket's waits are tens of seconds by design, so everything below runs on a virtual
clock (see run_paced): the assertions are about the delays the bucket computes, not about
sitting through them.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.services.llm import budget_from_body
from app.services.rate_limit import (
    TokenBucket,
    budget_for,
    estimate_tokens,
    reset_buckets,
)

# Groq's free tier, and the numbers from the 429s that prompted this module.
TPM = 8000
PER_SECOND = TPM / 60
VERIFY_CALL = 2900


@pytest.fixture(autouse=True)
def _clean_buckets():
    reset_buckets()
    yield
    reset_buckets()


def run_paced(scenario):
    """Run an async scenario with sleep and monotonic on a virtual clock.

    Returns (result, elapsed_seconds) where elapsed is virtual time - the wait the
    bucket actually imposed, measured without spending it.
    """
    real_sleep = asyncio.sleep
    real_monotonic = time.monotonic
    start = real_monotonic()
    now = start

    async def fake_sleep(delay, *args, **kwargs):
        nonlocal now
        now += delay
        # Still yield, so concurrent tasks interleave exactly as they would for real.
        await real_sleep(0)

    asyncio.sleep = fake_sleep
    time.monotonic = lambda: now
    try:
        result = asyncio.run(scenario())
    finally:
        asyncio.sleep = real_sleep
        time.monotonic = real_monotonic
    return result, now - start


def test_admits_immediately_while_budget_remains():
    async def scenario():
        return await TokenBucket(TPM).acquire(VERIFY_CALL)

    waited, _ = run_paced(scenario)
    assert waited == 0.0


def test_overrun_waits_for_exactly_the_missing_tokens():
    """The precise arithmetic from the 429 we were getting: 7752 used, 2588 wanted."""

    async def scenario():
        bucket = TokenBucket(TPM)
        await bucket.acquire(7752)
        return await bucket.acquire(2588)

    waited, _ = run_paced(scenario)
    # (7752 + 2588 - 8000) / (8000 / 60), the same figure Groq quoted back to us.
    assert waited == pytest.approx(17.55, abs=0.01)


def test_four_concurrent_calls_are_spread_across_the_budget():
    """The regression this whole change exists to prevent.

    Four calls reserving 2900 each is 11600 tokens - 3600 more than the bucket holds.
    Those 3600 have to be waited for at the refill rate, so the run cannot finish in
    less than 27 seconds. Before pacing, all four went out at once and three came back
    429.
    """
    admitted_at: list[float] = []

    async def scenario():
        bucket = TokenBucket(TPM)

        async def call():
            await bucket.acquire(VERIFY_CALL)
            admitted_at.append(time.monotonic())

        await asyncio.gather(*(call() for _ in range(4)))

    _, elapsed = run_paced(scenario)

    required = (4 * VERIFY_CALL - TPM) / PER_SECOND
    assert elapsed == pytest.approx(required, abs=0.01)
    # Two fit in the initial budget; the rest had to wait, which is the whole point.
    assert sum(1 for at in admitted_at if at == admitted_at[0]) == 2
    assert admitted_at == sorted(admitted_at), "admission must stay in arrival order"


def test_oversized_request_is_clamped_not_deadlocked():
    """A single call bigger than the whole budget must still go out, not hang."""

    async def scenario():
        return await TokenBucket(1000).acquire(50_000)

    waited, _ = run_paced(scenario)
    assert waited == pytest.approx(0.0)


def test_refund_returns_unused_reservation():
    async def scenario():
        bucket = TokenBucket(TPM)
        await bucket.acquire(VERIFY_CALL)
        bucket.refund(VERIFY_CALL - 600)  # reserved 2900, actually used 600
        return await bucket.acquire(5000)

    waited, _ = run_paced(scenario)
    assert waited == 0.0


def test_refund_cannot_exceed_capacity():
    async def scenario():
        bucket = TokenBucket(TPM)
        bucket.refund(99_999)
        assert bucket.capacity == TPM
        return await bucket.acquire(TPM)

    waited, _ = run_paced(scenario)
    assert waited == 0.0


def test_resync_adopts_the_providers_figures():
    async def scenario():
        bucket = TokenBucket(TPM)
        bucket.resync(limit=6000, used=6000)
        assert bucket.capacity == 6000
        # Nothing left, so the next call must wait rather than being admitted.
        return await bucket.acquire(1000)

    waited, _ = run_paced(scenario)
    assert waited == pytest.approx(1000 / (6000 / 60), abs=0.01)


def test_estimate_includes_the_max_tokens_reservation():
    """The provider bills max_tokens up front - an estimate that omits it is useless."""
    messages = [
        {"role": "system", "content": "x" * 1400},
        {"role": "user", "content": "y" * 700},
    ]
    estimate = estimate_tokens(messages, max_tokens=1024)
    assert estimate > 1024
    # ~2100 chars of prompt plus the reservation; in the ballpark of Groq's "Requested".
    assert 1600 <= estimate <= 2000


def test_buckets_are_per_model():
    """Agents 3 and 4 run different models, and must not spend each other's budget."""
    screening = budget_for("openai/gpt-oss-20b", TPM, 0)
    verification = budget_for("openai/gpt-oss-120b", TPM, 0)
    assert screening is not verification
    assert budget_for("openai/gpt-oss-20b", TPM, 0) is screening


def test_pacing_can_be_disabled():
    assert budget_for("openai/gpt-oss-120b", 0, 0) is None


def test_budget_is_read_out_of_the_real_429_body():
    body = (
        '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in '
        "organization `org_01m20pqxrvev5rh25wd6cn2y59` service tier `on_demand` on "
        "tokens per minute (TPM): Limit 8000, Used 7752, Requested 2588. Please try "
        'again in 17.549999999s.","type":"tokens","code":"rate_limit_exceeded"}}'
    )
    assert budget_from_body(body) == (8000.0, 7752.0)


def test_budget_from_body_tolerates_an_unrelated_error():
    assert budget_from_body('{"error":{"message":"model not found"}}') == (None, None)
