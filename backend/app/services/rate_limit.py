"""A client-side mirror of the provider's token budget, so we pace instead of retry.

Groq's free tier is a continuous-refill token bucket, per model: capacity TPM, refilling
at TPM/60 tokens per second. Its 429 body states the arithmetic outright - "Limit 8000,
Used 7752, Requested 2588 ... try again in 17.549999999s" is exactly
(7752 + 2588 - 8000) / (8000 / 60).

Retrying is the wrong tool for that. A retry is for something that *might* work now; a
token budget is a fact we can compute in advance, and four concurrent calls reserving
~2900 tokens each will overrun an 8000-token bucket every time, no matter how patiently
they back off. So the bucket is modelled here and the call waits for room before it is
sent. Retries stay as the safety net for the cases arithmetic cannot predict - a burst
we did not account for, another process sharing the key.

Buckets are keyed by model because the provider's limits are: Agent 3 on gpt-oss-20b and
Agent 4 on gpt-oss-120b do not spend each other's budget, and pacing them together would
throttle screening for no reason.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time

logger = logging.getLogger(__name__)

# Chars per token. Deliberately low - over-estimating the prompt costs us a little
# throughput, under-estimating costs a 429, and the 429 is far more expensive.
_CHARS_PER_TOKEN = 3.5

# Per-message framing the provider counts but the text does not contain (role, delimiters).
_MESSAGE_OVERHEAD_TOKENS = 8

# A token's worth of slack when comparing against the budget, and a floor under the
# sleep that follows. Both exist for the same reason, and it is not fussiness.
#
# The refill is elapsed * rate, and elapsed is a difference of two large monotonic
# timestamps, so it carries a rounding error: waiting exactly long enough for 380 tokens
# can leave 379.99999999999994. The shortfall then asks for a sleep of about 3e-15
# seconds - too small to move a clock reading ~1e5 at all - so the bucket waits, wakes
# with nothing refilled, and does it again forever. A whole token of tolerance costs
# nothing against a budget of thousands and makes that loop terminate.
_TOKEN_EPSILON = 1e-6
_MIN_SLEEP_SECONDS = 1e-3


class TokenBucket:
    """One token budget, refilling continuously over `period_seconds`.

    The period is a parameter because providers meter the same way on several
    timescales: Groq's minute and day limits differ only in capacity and period, and
    both refill smoothly rather than resetting on a boundary. The daily one was measured
    to confirm it - 200000/86400 predicts 69.4 tokens per 30s, and the observed refill
    across three consecutive 429s was 71, 70 and 72.
    """

    def __init__(self, capacity: int, *, period_seconds: float = 60.0) -> None:
        self._capacity = float(capacity)
        self._available = float(capacity)
        self._period = float(period_seconds)
        self._updated = time.monotonic()
        # Admission is serialised, and the wait happens while the lock is held. asyncio
        # locks are FIFO, so callers are admitted in arrival order: a small request
        # cannot slip past a large one that is already waiting, and nothing starves.
        self._lock = asyncio.Lock()

    @property
    def capacity(self) -> float:
        return self._capacity

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._updated
        self._updated = now
        rate = self._capacity / self._period
        self._available = min(self._capacity, self._available + elapsed * rate)

    def wait_for(self, tokens: float) -> float:
        """How long this call would have to wait, without waiting or spending anything.

        Lets a caller decide whether a wait is worth having before committing to it - a
        minute's pacing usually is, the rest of a day's quota never is.
        """
        want = max(0.0, min(float(tokens), self._capacity))
        self._refill()
        if self._available >= want - _TOKEN_EPSILON:
            return 0.0
        return (want - self._available) * self._period / self._capacity

    async def acquire(self, tokens: float) -> float:
        """Wait until `tokens` fit in the budget, then spend them. Returns seconds waited.

        A request larger than the whole budget is clamped rather than refused: it can
        never fit, and failing it here would only turn a slow call into a broken one.
        """
        want = max(0.0, min(float(tokens), self._capacity))
        waited = 0.0
        async with self._lock:
            while True:
                self._refill()
                if self._available >= want - _TOKEN_EPSILON:
                    self._available = max(0.0, self._available - want)
                    return waited
                delay = max(
                    (want - self._available) * self._period / self._capacity,
                    _MIN_SLEEP_SECONDS,
                )
                waited += delay
                await asyncio.sleep(delay)

    def refund(self, tokens: float) -> None:
        """Return an over-estimate to the budget once the real usage is known."""
        if tokens <= 0:
            return
        self._refill()
        self._available = min(self._capacity, self._available + float(tokens))

    def resync(self, *, limit: float | None, used: float | None) -> None:
        """Adopt the provider's own view of the budget, as stated in a 429 body.

        This is what keeps the estimate honest over time. Our token count is an
        approximation and another process may share the key, so the authoritative
        numbers only ever arrive attached to a rejection - and when they do, every
        caller waiting on this bucket starts pacing against the real figure instead of
        discovering it one 429 at a time.
        """
        if limit and limit > 0 and not math.isclose(limit, self._capacity):
            logger.info(
                "Adjusting token budget from %.0f to %.0f TPM (provider-reported).",
                self._capacity,
                limit,
            )
            self._capacity = float(limit)
        if used is not None:
            self._refill()
            self._available = min(self._available, max(0.0, self._capacity - float(used)))


class BudgetExhausted(RuntimeError):
    """The budget cannot fit this call soon enough to be worth waiting for.

    Carries `wait_seconds` and which limit ran out, so the caller can say something true
    to the researcher instead of reporting the model as unavailable.
    """

    def __init__(self, scope: str, wait_seconds: float) -> None:
        self.scope = scope
        self.wait_seconds = wait_seconds
        super().__init__(f"{scope} token budget exhausted for {wait_seconds:.0f}s")


class ModelBudget:
    """Every limit one model is subject to, enforced together.

    Providers meter on more than one timescale at once - Groq's free tier is 8000 tokens
    per minute *and* 200000 per day - and a call has to fit both. Modelling only the
    faster one is what let a day's quota run out invisibly: the minute bucket had room,
    so every call was admitted, and the daily limit could only ever be discovered by
    being rejected.

    Both are continuous-refill buckets on the same arithmetic; only the period differs.
    """

    def __init__(
        self,
        tokens_per_minute: int,
        tokens_per_day: int,
        output_tokens_per_minute: int = 0,
    ) -> None:
        self.minute = TokenBucket(tokens_per_minute) if tokens_per_minute > 0 else None
        self.day = (
            TokenBucket(tokens_per_day, period_seconds=86_400.0)
            if tokens_per_day > 0
            else None
        )
        # Metered separately from total tokens, and often the tighter of the two: a
        # 1000/min output allowance against a 8000/min total one means the completion
        # runs out first on any model that answers at length.
        self.output = (
            TokenBucket(output_tokens_per_minute) if output_tokens_per_minute > 0 else None
        )

    def _scoped(self, scope: str) -> TokenBucket | None:
        if scope == "day":
            return self.day
        if scope == "output":
            return self.output
        return self.minute

    async def acquire(
        self,
        tokens: float,
        *,
        output_tokens: float = 0.0,
        max_wait: float | None = None,
    ) -> float:
        """Reserve against every limit at once, or refuse if that takes too long.

        `tokens` is the whole request (prompt plus completion reservation); output_tokens
        is the completion part alone, which is metered on its own. A call has to fit
        every limit, so all of them are checked before any is spent - reserving from one
        bucket and then discovering another has no room would leave the first short for
        a call that never went out.

        The daily bucket is checked without sleeping: when a day's quota is gone the wait
        is measured in hours, and sitting on it would hold the other buckets' locks while
        every remaining paper queues behind a call that is going to fail anyway.
        """
        for scope, amount in (
            ("day", tokens),
            ("minute", tokens),
            ("output", output_tokens),
        ):
            bucket = self._scoped(scope)
            if bucket is None or amount <= 0:
                continue
            needed = bucket.wait_for(amount)
            if max_wait is not None and needed > max_wait:
                raise BudgetExhausted(scope, needed)

        waited = 0.0
        if self.day is not None:
            waited += await self.day.acquire(tokens)
        if self.minute is not None:
            waited += await self.minute.acquire(tokens)
        if self.output is not None and output_tokens > 0:
            waited += await self.output.acquire(output_tokens)
        return waited

    def refund(self, tokens: float, output_tokens: float = 0.0) -> None:
        for bucket in (self.minute, self.day):
            if bucket is not None:
                bucket.refund(tokens)
        if self.output is not None:
            self.output.refund(output_tokens)

    def resync(self, *, scope: str, limit: float | None, used: float | None) -> None:
        """Adopt the provider's figures for whichever limit it just quoted at us.

        Only the bucket the message was actually about. An output limit is not a total
        limit, and applying one to the other does real damage - it once rewrote an
        8000-token minute budget as a 1000-token one, after which nothing fit at all.
        """
        bucket = self._scoped(scope)
        if bucket is not None:
            bucket.resync(limit=limit, used=used)


_budgets: dict[str, ModelBudget] = {}


def budget_for(
    model: str,
    tokens_per_minute: int,
    tokens_per_day: int,
    output_tokens_per_minute: int = 0,
) -> ModelBudget | None:
    """The budget for one model, created on first use. None disables pacing."""
    if tokens_per_minute <= 0 and tokens_per_day <= 0 and output_tokens_per_minute <= 0:
        return None
    existing = _budgets.get(model)
    if existing is None:
        existing = ModelBudget(tokens_per_minute, tokens_per_day, output_tokens_per_minute)
        _budgets[model] = existing
    return existing


def reset_buckets() -> None:
    """Drop every budget. For tests, and for a config change at runtime."""
    _budgets.clear()


def estimate_tokens(messages: list[dict[str, str]], max_tokens: int) -> float:
    """What the provider will charge this call against the budget, before it is sent.

    max_tokens is included because the provider reserves it up front: in the 429 above,
    "Requested 2588" is the prompt plus the full completion reservation, not the tokens
    the model actually went on to produce. Trimming max_tokens is therefore a direct
    reduction in throughput cost, not just a cap on output length.
    """
    chars = sum(len(str(message.get("content") or "")) for message in messages)
    prompt = chars / _CHARS_PER_TOKEN + _MESSAGE_OVERHEAD_TOKENS * len(messages)
    return prompt + max(0, int(max_tokens))
