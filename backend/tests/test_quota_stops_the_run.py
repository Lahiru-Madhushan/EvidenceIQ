"""A spent quota must stop the run, and must reach the researcher intact.

Two faults showed up in the logs once the quota detection itself worked:

1. The accurate message the client produced ("the daily quota is spent, it has room
   again in about 9 minutes") was logged, then thrown away and replaced at the router
   with "The verification model is unavailable" - which is not what happened and gives
   nobody anything to act on.

2. The batch kept going. Every remaining paper was screened, spending Agent 3's separate
   quota, and then failed verification for the reason already known before it started.
   Eight papers, sixteen model calls, zero verified papers.
"""

from __future__ import annotations

import asyncio

import pytest

from app.schemas.paper import Paper
from app.schemas.pipeline import PipelineItem, PipelineStatus
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.services.agent_client import AgentCallError
from app.services.pipeline import QuotaGate, run_pipeline

QUOTA_MESSAGE = (
    "Agent 4 (Verification) returned HTTP 429: The daily token quota for "
    "openai/gpt-oss-120b is spent; it has room again in about 9 minutes."
)


def _paper(pmid: str) -> Paper:
    return Paper(pmid=pmid, title="t", abstract="a", year=2023, publication_types=[])


def _protocol() -> Protocol:
    return Protocol.model_validate(
        {"inclusion": {"population": "adults"}, "exclusion": {}}
    )


class FakeClient:
    """Counts what each agent was actually asked to do."""

    def __init__(self, *, verify_status: int | None = None):
        self.screened: list[str] = []
        self.verified: list[str] = []
        self._verify_status = verify_status

    async def screen(self, paper, protocol):
        self.screened.append(paper.pmid)
        return ScreeningDecision(decision=Decision.INCLUDE, reason="looks relevant")

    async def verify(self, paper, protocol, screening):
        self.verified.append(paper.pmid)
        if self._verify_status is not None:
            raise AgentCallError(
                "Agent 4 (Verification)", QUOTA_MESSAGE, status_code=self._verify_status
            )
        raise AssertionError("not reached in these tests")


# --- the gate itself ----------------------------------------------------------------


def test_a_429_from_an_agent_trips_the_gate():
    gate = QuotaGate()
    gate.consider(AgentCallError("Agent 4", QUOTA_MESSAGE, status_code=429))
    assert gate.tripped
    assert gate.reason == QUOTA_MESSAGE


@pytest.mark.parametrize("status_code", [500, 502, 503, 422, None])
def test_other_failures_do_not_stop_the_run(status_code):
    """One unreachable paper is not a reason to abandon the other forty-nine."""
    gate = QuotaGate()
    gate.consider(AgentCallError("Agent 4", "boom", status_code=status_code))
    assert not gate.tripped


def test_the_first_reason_is_the_one_kept():
    gate = QuotaGate()
    gate.consider(AgentCallError("Agent 4", QUOTA_MESSAGE, status_code=429))
    gate.consider(AgentCallError("Agent 4", "a later, less useful message", 429))
    assert gate.reason == QUOTA_MESSAGE


def test_run_pipeline_trips_the_gate_on_a_verification_quota_failure():
    """And still returns the screening decision, which was really made."""
    client = FakeClient(verify_status=429)
    gate = QuotaGate()

    result = asyncio.run(
        run_pipeline(_paper("111"), _protocol(), client, gate=gate)
    )

    assert result.status is PipelineStatus.VERIFICATION_FAILED
    assert result.screening.decision is Decision.INCLUDE, "screening must survive"
    assert gate.tripped


def test_run_pipeline_leaves_the_gate_alone_on_an_ordinary_failure():
    client = FakeClient(verify_status=503)
    gate = QuotaGate()

    result = asyncio.run(run_pipeline(_paper("222"), _protocol(), client, gate=gate))

    assert result.status is PipelineStatus.VERIFICATION_FAILED
    assert not gate.tripped


# --- what the batch does with it -----------------------------------------------------


def test_remaining_papers_are_not_screened_once_the_quota_is_gone():
    """The expensive half of the bug: screening quota spent on unverifiable papers."""
    client = FakeClient(verify_status=429)
    gate = QuotaGate()
    pmids = [str(n) for n in range(8)]

    async def run_batch():
        # Sequential, mirroring what a concurrency-1 batch does; the gate is checked
        # where the work would start.
        items = []
        for pmid in pmids:
            if gate.tripped:
                items.append(PipelineItem(pmid=pmid, error=gate.reason, not_started=True))
                continue
            result = await run_pipeline(_paper(pmid), _protocol(), client, gate=gate)
            items.append(PipelineItem(pmid=pmid, result=result))
        return items

    items = asyncio.run(run_batch())

    # Only the first paper was worked on; the rest never reached either agent.
    assert client.screened == ["0"]
    assert client.verified == ["0"]
    assert sum(1 for item in items if item.not_started) == 7


def test_not_started_papers_are_not_counted_as_failures():
    """They cost nothing and wrote nothing - they are the set to re-run tomorrow."""
    from app.routers.pipeline import _summarise

    items = [PipelineItem(pmid="0", error="real failure")]
    items += [
        PipelineItem(pmid=str(n), error=QUOTA_MESSAGE, not_started=True)
        for n in range(1, 8)
    ]

    summary = _summarise(items, skipped=0, stopped_reason=QUOTA_MESSAGE)

    assert summary.failed == 1, "seven untouched papers are not seven broken ones"
    assert summary.not_started == 7
    assert summary.stopped_reason == QUOTA_MESSAGE
    assert summary.total == 8
