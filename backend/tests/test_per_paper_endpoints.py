"""Running the two agents one paper at a time.

The phase endpoints screen a whole page and then verify a whole page. That is the right
shape when the goal is "screen this review", but not when the goal is "find me ten papers
both agents accept": the count that decides when to stop is only knowable once a page has
been fully verified, so the run overshoots by however much of the page was left.

These endpoints let a caller run one paper all the way through and then decide. What is
tested here is the part that makes that safe to drive from outside: each endpoint writes
only its own agent's columns, both record an audit event, a spent quota is reported as
429 rather than 502 so the caller can tell "stop" from "retry", and Agent 4 reads the
draft off the row rather than trusting the caller for it.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user
from app.main import app
from app.models.paper import Paper as PaperModel
from app.models.paper_event import ACTOR_AGENT_3, ACTOR_AGENT_4
from app.models.review import Review as ReviewModel
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import (
    Confidence,
    VerificationResult,
    VerificationStatus,
)
from app.services.llm import LLMError, LLMQuotaExhausted

OWNER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"

PROTOCOL = {
    "population": "Adults",
    "condition": "Type 2 diabetes",
    "intervention": "Metformin",
    "date_range": {"from": 2015, "to": 2026},
    "excludes": ["type 1 diabetes"],
    "additional_criteria": [],
}


class FakeSession:
    """Just enough Session for these routers: get(), add() and commit()."""

    def __init__(self, rows: dict):
        self._rows = rows
        self.added: list = []
        self.commits = 0

    def get(self, model, key):
        return self._rows.get((model, str(key)))

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def _paper(review_id, **overrides) -> PaperModel:
    row = PaperModel(
        id=uuid.uuid4(),
        review_id=review_id,
        pmid="12345678",
        title="Metformin in adults with type 2 diabetes",
        abstract="A randomised controlled trial in adults with type 2 diabetes.",
        journal="J Diabetes",
        year=2023,
        publication_types=["Journal Article"],
    )
    for name, value in overrides.items():
        setattr(row, name, value)
    return row


def _review(owner=OWNER, protocol=PROTOCOL) -> ReviewModel:
    return ReviewModel(
        id=uuid.uuid4(),
        owner_id=uuid.UUID(owner),
        research_question="Does metformin help?",
        raw_criteria="adults, type 2 diabetes",
        protocol=protocol,
        status="screening",
    )


def _verification(pmid: str, verified=Decision.INCLUDE, screened=Decision.INCLUDE):
    return VerificationResult(
        pmid=pmid,
        verified_decision=verified,
        screening_decision=screened,
        agreement=verified is screened,
        verification_status=(
            VerificationStatus.VERIFIED if verified is screened
            else VerificationStatus.DISAGREEMENT
        ),
        confidence=Confidence.HIGH,
        checks=[],
        issues=[],
        verification_note="ok",
        needs_human_review=verified is not screened,
    )


@pytest.fixture
def harness():
    """A signed-in owner, one review, one paper, and a session holding both."""
    review = _review()
    paper = _paper(review.id)
    session = FakeSession(
        {(ReviewModel, str(review.id)): review, (PaperModel, str(paper.id)): paper}
    )

    def override_db():
        # A generator, not a lambda returning one: FastAPI inspects the callable to
        # decide whether a dependency needs closing, and treats a plain return value as
        # the session itself.
        yield session

    app.dependency_overrides[get_current_user] = lambda: {"sub": OWNER}
    app.dependency_overrides[get_db] = override_db

    yield TestClient(app), session, review, paper

    app.dependency_overrides.clear()


# --- Agent 4's new endpoint ---------------------------------------------------------


def test_verify_by_id_reads_the_draft_off_the_row(harness, monkeypatch):
    """What gets verified is what Agent 3 recorded, not what a caller supplies."""
    client, session, _review_row, paper = harness
    paper.draft_decision = "EXCLUDE"
    paper.draft_reason = "Participants were adolescents."

    seen = {}

    async def fake_verify(request):
        seen["decision"] = request.screening_decision
        return _verification(paper.pmid, screened=Decision.EXCLUDE, verified=Decision.EXCLUDE)

    monkeypatch.setattr("app.routers.verification.verify", fake_verify)

    response = client.post(f"/api/verify/by-id/{paper.id}")

    assert response.status_code == 200
    assert seen["decision"].decision is Decision.EXCLUDE
    assert seen["decision"].reason == "Participants were adolescents."


def test_verify_by_id_writes_only_agent_4s_columns(harness, monkeypatch):
    client, session, _review_row, paper = harness
    paper.draft_decision = "INCLUDE"
    paper.draft_reason = "Matches the protocol."

    async def fake_verify(request):
        return _verification(paper.pmid)

    monkeypatch.setattr("app.routers.verification.verify", fake_verify)

    assert client.post(f"/api/verify/by-id/{paper.id}").status_code == 200

    # Agent 4's columns are set...
    assert paper.verified_decision == "INCLUDE"
    assert paper.agreement is True
    assert paper.verified_at is not None
    # ...and Agent 3's are untouched by it.
    assert paper.draft_decision == "INCLUDE"
    assert paper.draft_reason == "Matches the protocol."


def test_verify_by_id_records_an_audit_event(harness, monkeypatch):
    """papers holds only the current value, so a re-run without this erases the last one."""
    client, session, _review_row, paper = harness
    paper.draft_decision = "INCLUDE"

    async def fake_verify(request):
        return _verification(paper.pmid)

    monkeypatch.setattr("app.routers.verification.verify", fake_verify)
    client.post(f"/api/verify/by-id/{paper.id}")

    events = [obj for obj in session.added if getattr(obj, "actor", None) == ACTOR_AGENT_4]
    assert len(events) == 1
    assert events[0].detail["verified_decision"] == "INCLUDE"


def test_verify_by_id_refuses_an_unscreened_paper(harness):
    """Agent 4 reviews a completed screening pass; there is nothing to review yet."""
    client, _session, _review_row, paper = harness

    response = client.post(f"/api/verify/by-id/{paper.id}")

    assert response.status_code == 422
    assert "Agent 3 must run first" in response.json()["detail"]


@pytest.mark.parametrize("value", [None, "", "GARBAGE"])
def test_verify_by_id_refuses_an_unusable_stored_decision(harness, value):
    client, _session, _review_row, paper = harness
    paper.draft_decision = value

    assert client.post(f"/api/verify/by-id/{paper.id}").status_code == 422


def test_verify_by_id_refuses_a_review_you_do_not_own(harness, monkeypatch):
    """RLS does not cover this connection, so the router is the only thing checking."""
    client, _session, _review_row, paper = harness
    paper.draft_decision = "INCLUDE"
    app.dependency_overrides[get_current_user] = lambda: {"sub": STRANGER}

    response = client.post(f"/api/verify/by-id/{paper.id}")

    assert response.status_code == 403
    assert paper.verified_decision is None


def test_verify_by_id_reports_a_spent_quota_as_429(harness, monkeypatch):
    """The caller reads this status to decide whether to fetch another paper.

    502 would say "this one broke, try the next", which against a spent budget spends
    the rest of the run discovering the same thing once per paper.
    """
    client, _session, _review_row, paper = harness
    paper.draft_decision = "INCLUDE"

    async def out_of_quota(request):
        raise LLMQuotaExhausted("Daily quota spent.", scope="day", wait_seconds=1800)

    monkeypatch.setattr("app.routers.verification.verify", out_of_quota)

    response = client.post(f"/api/verify/by-id/{paper.id}")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "1800"
    assert paper.verified_decision is None


def test_verify_by_id_records_nothing_when_the_model_fails(harness, monkeypatch):
    client, session, _review_row, paper = harness
    paper.draft_decision = "INCLUDE"

    async def broken(request):
        raise LLMError("upstream exploded")

    monkeypatch.setattr("app.routers.verification.verify", broken)

    assert client.post(f"/api/verify/by-id/{paper.id}").status_code == 502
    assert paper.verified_decision is None
    assert session.commits == 0


# --- Agent 3's endpoint, which the same loop drives ---------------------------------


def test_screen_by_id_records_an_audit_event(harness, monkeypatch):
    """This used to write its columns inline and log nothing.

    Harmless while it was a rarely used endpoint; not harmless once it is the normal way
    every paper gets screened, because then no screening at all reaches paper_events.
    """
    client, session, _review_row, paper = harness

    async def fake_screen(paper_in, protocol):
        return ScreeningDecision(
            pmid=paper_in.pmid, decision=Decision.INCLUDE, reason="Matches."
        )

    monkeypatch.setattr("app.routers.screening.screen", fake_screen)

    assert client.post(f"/api/screen/by-id/{paper.id}").status_code == 200

    events = [obj for obj in session.added if getattr(obj, "actor", None) == ACTOR_AGENT_3]
    assert len(events) == 1
    assert events[0].detail["decision"] == "INCLUDE"
    assert paper.draft_decision == "INCLUDE"
    # Agent 4's columns are not this endpoint's to touch.
    assert paper.verified_decision is None


def test_screen_by_id_reports_a_spent_quota_as_429(harness, monkeypatch):
    """LLMQuotaExhausted subclasses LLMError, so ordering the handlers wrong hides it."""
    client, _session, _review_row, paper = harness

    async def out_of_quota(paper_in, protocol):
        raise LLMQuotaExhausted("Daily quota spent.", scope="day", wait_seconds=900)

    monkeypatch.setattr("app.routers.screening.screen", out_of_quota)

    response = client.post(f"/api/screen/by-id/{paper.id}")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    assert paper.draft_decision is None


def test_both_per_paper_endpoints_are_mounted():
    from app.main import app as live_app

    paths = {route.path for route in live_app.routes}
    assert "/api/screen/by-id/{paper_id}" in paths
    assert "/api/verify/by-id/{paper_id}" in paths
