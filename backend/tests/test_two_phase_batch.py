"""A batch screens everything, then verifies everything. In that order.

Interleaving the two agents per paper meant a spent verification quota also cost the
researcher the screening results for every paper the run had not reached yet - even
though Agent 3 is on a different model with its own, untouched budget. Screening first
means the draft pass always completes on its own quota, and the second opinion fills in
behind it as far as it can get.
"""

from __future__ import annotations

import asyncio

import pytest

from app.schemas.paper import Paper
from app.schemas.pipeline import PipelineStatus
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import (
    Confidence,
    VerificationResult,
    VerificationStatus,
)
from app.services.agent_client import AgentCallError
from app.services.pipeline import run_batch

QUOTA = "Agent 4 (Verification) returned HTTP 429: The daily token quota is spent."


def _protocol() -> Protocol:
    return Protocol.model_validate({"inclusion": {"population": "adults"}, "exclusion": {}})


def _papers(n: int) -> list[tuple[str, Paper]]:
    return [
        (f"key{i}", Paper(pmid=str(i), title="t", abstract="a", year=2023, publication_types=[]))
        for i in range(n)
    ]


def _verification(pmid: str) -> VerificationResult:
    return VerificationResult(
        pmid=pmid,
        verified_decision=Decision.INCLUDE,
        screening_decision=Decision.INCLUDE,
        agreement=True,
        confidence=Confidence.HIGH,
        needs_human_review=False,
        verification_status=VerificationStatus.VERIFIED,
        verification_note="checked",
        checks=[],
        issues=[],
    )


class RecordingClient:
    """Records the order the agents were called in, across all papers."""

    def __init__(self, *, verify_fails_after: int | None = None, verify_status: int = 429):
        self.calls: list[str] = []
        self.screened: list[str] = []
        self.verified: list[str] = []
        self._verify_fails_after = verify_fails_after
        self._verify_status = verify_status

    async def screen(self, paper, protocol):
        self.calls.append("screen")
        self.screened.append(paper.pmid)
        await asyncio.sleep(0)
        return ScreeningDecision(decision=Decision.INCLUDE, reason="relevant")

    async def verify(self, paper, protocol, screening):
        self.calls.append("verify")
        await asyncio.sleep(0)
        if (
            self._verify_fails_after is not None
            and len(self.verified) >= self._verify_fails_after
        ):
            raise AgentCallError(
                "Agent 4 (Verification)", QUOTA, status_code=self._verify_status
            )
        self.verified.append(paper.pmid)
        return _verification(paper.pmid)


def _run(client, n=6, concurrency=2):
    return asyncio.run(
        run_batch(_papers(n), _protocol(), client, concurrency=concurrency)
    )


def test_every_screen_happens_before_any_verify():
    """The ordering the request was about, asserted on the call sequence itself."""
    client = RecordingClient()
    items, stopped = _run(client, n=6)

    assert client.calls == ["screen"] * 6 + ["verify"] * 6
    assert stopped is None
    assert all(item.result.status is PipelineStatus.COMPLETE for _, item in items)


def test_all_papers_are_screened_even_when_verification_has_no_quota():
    """The regression: a spent Agent 4 budget used to cost Agent 3's results too."""
    client = RecordingClient(verify_fails_after=0)  # verification dead from the start
    items, stopped = _run(client, n=6)

    assert client.screened == [str(i) for i in range(6)], "all six still screened"
    assert client.verified == []
    assert stopped == QUOTA

    for _, item in items:
        assert item.result is not None, "the screening decision survives"
        assert item.result.screening.decision is Decision.INCLUDE
        assert item.result.status is PipelineStatus.VERIFICATION_FAILED
        assert item.result.verification is None


def test_verification_stops_at_the_quota_but_keeps_what_it_did():
    client = RecordingClient(verify_fails_after=2)
    items, stopped = _run(client, n=6, concurrency=1)

    assert len(client.screened) == 6
    assert len(client.verified) == 2
    assert stopped == QUOTA

    results = [item.result for _, item in items]
    assert sum(1 for r in results if r.status is PipelineStatus.COMPLETE) == 2
    assert sum(1 for r in results if r.status is PipelineStatus.VERIFICATION_FAILED) == 4


def test_results_come_back_in_the_order_they_went_in():
    """Two phases and concurrency must not shuffle the researcher's list."""
    client = RecordingClient()
    items, _ = _run(client, n=6, concurrency=3)
    assert [item.pmid for _, item in items] == [str(i) for i in range(6)]
    assert [key for key, _ in items] == [f"key{i}" for i in range(6)]


def test_an_ordinary_verification_failure_does_not_stop_the_phase():
    """Only 429 stops a run; one bad paper must not end the pass."""

    class FlakyOnce(RecordingClient):
        async def verify(self, paper, protocol, screening):
            if paper.pmid == "2":
                raise AgentCallError("Agent 4", "upstream hiccup", status_code=503)
            return await super().verify(paper, protocol, screening)

    client = FlakyOnce()
    items, stopped = _run(client, n=6, concurrency=1)

    assert stopped is None
    results = [item.result for _, item in items]
    assert sum(1 for r in results if r.status is PipelineStatus.COMPLETE) == 5
    assert sum(1 for r in results if r.status is PipelineStatus.VERIFICATION_FAILED) == 1


def test_a_screening_quota_failure_skips_the_rest_of_the_screening_pass():
    """Nothing to verify without a draft, so the second phase simply has less to do."""

    class ScreeningDead:
        def __init__(self):
            self.screened = []
            self.verified = []

        async def screen(self, paper, protocol):
            raise AgentCallError("Agent 3 (Screening)", "quota", status_code=429)

        async def verify(self, paper, protocol, screening):  # pragma: no cover
            raise AssertionError("nothing was screened, so nothing can be verified")

    items, stopped = _run(ScreeningDead(), n=4)

    assert stopped is not None and "quota" in stopped
    assert all(item.result is None for _, item in items)
    # The first paper genuinely failed; the rest were never attempted.
    assert sum(1 for _, item in items if item.not_started) == 3


def test_an_empty_batch_is_not_an_error():
    items, stopped = _run(RecordingClient(), n=0)
    assert items == []
    assert stopped is None
