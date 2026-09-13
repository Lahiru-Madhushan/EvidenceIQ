"""The two agents run in phases, and the API now lets a caller see the boundary.

With one combined endpoint the client could not tell when screening finished, so the
progress view showed Agent 3 and Agent 4 running at the same moment - a state the
backend stopped occupying when run_batch became two phases. These endpoints exist so the
UI can describe what actually happens.

Committing each phase separately is the other half of it: after the screening pass every
paper carries a draft decision, which is a coherent state worth saving before Agent 4
spends a quota that might run out.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from app.schemas.paper import Paper
from app.schemas.protocol import DateRange, Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import (
    Confidence,
    VerificationResult,
    VerificationStatus,
)
from app.services.agent_client import AgentCallError
from app.services.pipeline import run_screening_phase, run_verification_phase

QUOTA = "Agent 4 (Verification) returned HTTP 429: daily quota spent."


def _protocol() -> Protocol:
    return Protocol(
        population="Adults", condition="Type 2 diabetes", intervention="Metformin",
        date_range=DateRange(from_year=2015, to_year=2026), excludes=["type 1 diabetes"],
    )


def _entries(n: int):
    return [
        (f"k{i}", Paper(pmid=str(i), title="t", abstract="a", year=2023, publication_types=[]))
        for i in range(n)
    ]


def _verification(pmid: str) -> VerificationResult:
    return VerificationResult(
        pmid=pmid, verified_decision=Decision.INCLUDE, screening_decision=Decision.INCLUDE,
        agreement=True, verification_status=VerificationStatus.VERIFIED,
        confidence=Confidence.HIGH, checks=[], issues=[], verification_note="ok",
        needs_human_review=False,
    )


class Client:
    def __init__(self, *, screen_fails_after=None, verify_fails_after=None, status=429):
        self.screened: list[str] = []
        self.verified: list[str] = []
        self._sf, self._vf, self._status = screen_fails_after, verify_fails_after, status

    async def screen(self, paper, protocol):
        if self._sf is not None and len(self.screened) >= self._sf:
            raise AgentCallError("Agent 3 (Screening)", "quota", status_code=self._status)
        self.screened.append(paper.pmid)
        return ScreeningDecision(pmid=paper.pmid, decision=Decision.INCLUDE, reason="ok")

    async def verify(self, paper, protocol, screening):
        if self._vf is not None and len(self.verified) >= self._vf:
            raise AgentCallError("Agent 4 (Verification)", QUOTA, status_code=self._status)
        self.verified.append(paper.pmid)
        return _verification(paper.pmid)


# --- the screening phase on its own ---------------------------------------------------


def test_the_screening_phase_touches_only_agent_3():
    """It must be able to finish and be reported without Agent 4 being involved."""
    client = Client()
    drafts, stopped = asyncio.run(
        run_screening_phase(_entries(5), _protocol(), client, concurrency=2)
    )

    assert client.screened == ["0", "1", "2", "3", "4"]
    assert client.verified == [], "verification has not started yet"
    assert stopped is None
    assert all(decision is not None for _, _, decision, _, _ in drafts)


def test_the_screening_phase_reports_its_own_stop_reason():
    client = Client(screen_fails_after=2)
    drafts, stopped = asyncio.run(
        run_screening_phase(_entries(6), _protocol(), client, concurrency=1)
    )

    assert stopped is not None and "quota" in stopped
    assert len(client.screened) == 2
    # Two screened, one that hit the wall, the rest never attempted.
    assert sum(1 for _, _, d, _, _ in drafts if d is not None) == 2
    assert sum(1 for _, _, _, _, not_started in drafts if not_started) == 3


def test_drafts_come_back_in_order():
    client = Client()
    drafts, _ = asyncio.run(
        run_screening_phase(_entries(6), _protocol(), client, concurrency=3)
    )
    assert [key for key, _, _, _, _ in drafts] == [f"k{i}" for i in range(6)]


# --- the verification phase on its own ------------------------------------------------


def test_the_verification_phase_keys_results_back_to_papers():
    client = Client()
    drafts = [
        (key, paper, ScreeningDecision(pmid=paper.pmid, decision=Decision.INCLUDE, reason="r"))
        for key, paper in _entries(4)
    ]
    checked, stopped = asyncio.run(
        run_verification_phase(drafts, _protocol(), client, concurrency=2)
    )

    assert stopped is None
    assert set(checked) == {"k0", "k1", "k2", "k3"}
    assert all(verification is not None for verification, _ in checked.values())


def test_the_verification_phase_stops_on_a_spent_quota_and_says_so():
    client = Client(verify_fails_after=2)
    drafts = [
        (key, paper, ScreeningDecision(pmid=paper.pmid, decision=Decision.INCLUDE, reason="r"))
        for key, paper in _entries(6)
    ]
    checked, stopped = asyncio.run(
        run_verification_phase(drafts, _protocol(), client, concurrency=1)
    )

    assert stopped == QUOTA
    assert len(client.verified) == 2
    done = sum(1 for verification, _ in checked.values() if verification is not None)
    assert done == 2, "what was verified before the wall is kept"


def test_a_verification_quota_cannot_undo_the_screening_pass():
    """The reason the phases are committed separately."""
    client = Client(verify_fails_after=0)

    drafts, screen_stopped = asyncio.run(
        run_screening_phase(_entries(5), _protocol(), client, concurrency=2)
    )
    assert screen_stopped is None
    assert len(client.screened) == 5, "every paper screened"

    pairs = [(k, p, d) for k, p, d, _, _ in drafts]
    _, verify_stopped = asyncio.run(
        run_verification_phase(pairs, _protocol(), client, concurrency=2)
    )
    assert verify_stopped == QUOTA
    # Agent 3's work stands on its own; nothing about it depended on Agent 4.
    assert len(client.screened) == 5


def test_an_ordinary_verification_failure_does_not_stop_the_phase():
    class Flaky(Client):
        async def verify(self, paper, protocol, screening):
            if paper.pmid == "2":
                raise AgentCallError("Agent 4", "hiccup", status_code=503)
            return await super().verify(paper, protocol, screening)

    client = Flaky()
    drafts = [
        (key, paper, ScreeningDecision(pmid=paper.pmid, decision=Decision.INCLUDE, reason="r"))
        for key, paper in _entries(5)
    ]
    checked, stopped = asyncio.run(
        run_verification_phase(drafts, _protocol(), client, concurrency=1)
    )

    assert stopped is None
    assert sum(1 for v, _ in checked.values() if v is not None) == 4
    assert checked["k2"][0] is None and "hiccup" in checked["k2"][1]


def test_an_empty_verification_phase_is_not_an_error():
    checked, stopped = asyncio.run(
        run_verification_phase([], _protocol(), Client(), concurrency=2)
    )
    assert checked == {} and stopped is None


# --- the endpoints are wired ----------------------------------------------------------


def test_both_phase_routes_exist():
    from app.main import app

    paths = {route.path for route in app.routes}
    assert "/api/pipeline/review/{review_id}/screen" in paths
    assert "/api/pipeline/review/{review_id}/verify" in paths
    # The combined endpoint stays, for callers that do not show progress.
    assert "/api/pipeline/review/{review_id}" in paths


def test_the_decision_is_read_back_off_the_row():
    """Agent 4 verifies what was recorded, not what a caller claims was recorded."""
    from app.models.paper import Paper as PaperModel
    from app.routers.pipeline import _decision_from_row

    row = PaperModel(id=uuid.uuid4(), pmid="99", draft_decision="EXCLUDE", draft_reason="why")
    decision = _decision_from_row(row)
    assert decision is not None
    assert decision.decision is Decision.EXCLUDE
    assert decision.reason == "why"


@pytest.mark.parametrize("value", [None, "", "GARBAGE"])
def test_an_unusable_stored_decision_is_skipped_not_guessed(value):
    from app.models.paper import Paper as PaperModel
    from app.routers.pipeline import _decision_from_row

    row = PaperModel(id=uuid.uuid4(), pmid="99", draft_decision=value, draft_reason="")
    assert _decision_from_row(row) is None
