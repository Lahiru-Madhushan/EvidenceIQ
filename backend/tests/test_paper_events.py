"""The audit trail, and the column-ownership split it records.

Two things are asserted here:

* Every agent run leaves a paper_events row, so a decision that is later overwritten in
  `papers` is still recoverable. Without this the Database Guide's promise to "log every
  screening decision, who approved or overrode what and when" is a claim with nothing
  behind it.
* Each agent's writer touches only that agent's columns (Guide section 11). That split
  used to be a comment asking callers to behave; these tests make it a property.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.paper import Paper as PaperModel
from app.models.paper_event import (
    ACTION_SCREENED,
    ACTION_VERIFIED,
    ACTOR_AGENT_3,
    ACTOR_AGENT_4,
    PaperEvent,
)
from app.schemas.pipeline import PipelineResult, PipelineStatus
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import (
    CheckSource,
    CheckStatus,
    Confidence,
    CriterionCheck,
    VerificationResult,
    VerificationStatus,
)
from app.services.pipeline import (
    record_pipeline_result,
    record_screening,
    record_verification,
)

# Agent 3's columns and Agent 4's columns, per the Guide's section 11 split.
AGENT_3_COLUMNS = ("draft_decision", "draft_reason", "screened_at")
AGENT_4_COLUMNS = (
    "verified_decision",
    "confidence",
    "agreement",
    "needs_human_review",
    "verification_note",
    "checks",
    "issues",
    "verified_at",
)


class FakeSession:
    """Collects what would be inserted.

    These functions only set attributes and call db.add(), so a real database adds
    nothing to the test but a Postgres dependency - SQLite cannot compile JSONB or
    UUID columns, and mapping them would test the mapping rather than the behaviour.
    The model's fit against the real table is covered by the live schema check.
    """

    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)

    @property
    def events(self) -> list[PaperEvent]:
        return [o for o in self.added if isinstance(o, PaperEvent)]


@pytest.fixture()
def db():
    return FakeSession()


@pytest.fixture()
def paper():
    """A transient row: unset columns read back as None, which is what we assert on."""
    return PaperModel(id=uuid.uuid4(), review_id=uuid.uuid4(), pmid="38221190", title="t")


def a_screening():
    return ScreeningDecision(pmid="38221190", decision=Decision.INCLUDE, reason="fits")


def a_verification(decision=Decision.EXCLUDE, agreement=False):
    return VerificationResult(
        pmid="38221190",
        verified_decision=decision,
        screening_decision=Decision.INCLUDE,
        agreement=agreement,
        verification_status=VerificationStatus.DISAGREEMENT,
        confidence=Confidence.MEDIUM,
        checks=[CriterionCheck(
            criterion="intervention", status=CheckStatus.FAIL,
            evidence="5:2 diet", source=CheckSource.LLM,
        )],
        issues=["something odd"],
        verification_note="disagreed on intervention",
        needs_human_review=True,
    )


def test_screening_writes_only_agent_3_columns(db, paper):
    record_screening(db, paper, a_screening())

    assert paper.draft_decision == "INCLUDE"
    assert paper.screened_at is not None
    for column in AGENT_4_COLUMNS:
        assert getattr(paper, column) is None, f"Agent 3 wrote Agent 4's {column}"


def test_verification_writes_only_agent_4_columns(db, paper):
    record_verification(db, paper, a_verification())

    assert paper.verified_decision == "EXCLUDE"
    assert paper.agreement is False
    assert paper.verified_at is not None
    for column in AGENT_3_COLUMNS:
        assert getattr(paper, column) is None, f"Agent 4 wrote Agent 3's {column}"


def test_screening_logs_an_event(db, paper):
    record_screening(db, paper, a_screening())

    event = db.events[0]
    assert len(db.events) == 1
    assert event.paper_id == paper.id
    assert event.actor == ACTOR_AGENT_3
    assert event.action == ACTION_SCREENED
    assert event.detail["decision"] == "INCLUDE"


def test_verification_logs_an_event_including_its_evidence(db, paper):
    record_verification(db, paper, a_verification())

    event = db.events[0]
    assert len(db.events) == 1
    assert event.actor == ACTOR_AGENT_4
    assert event.action == ACTION_VERIFIED
    assert event.detail["agreement"] is False
    assert event.detail["needs_human_review"] is True
    # The evidence must be snapshotted: papers.checks holds only the latest run.
    assert event.detail["checks"][0]["criterion"] == "intervention"
    assert event.detail["issues"] == ["something odd"]


def test_a_rerun_keeps_the_superseded_decision_in_the_log(db, paper):
    """The whole point of the table: papers holds current state, events hold history."""
    record_verification(db, paper, a_verification(Decision.EXCLUDE, agreement=False))
    record_verification(db, paper, a_verification(Decision.INCLUDE, agreement=True))

    assert paper.verified_decision == "INCLUDE"  # current state was overwritten
    decisions = [e.detail["verified_decision"] for e in db.events]
    assert decisions == ["EXCLUDE", "INCLUDE"]  # but both runs survive


def test_pipeline_result_records_both_agents(db, paper):
    result = PipelineResult(
        pmid="38221190", status=PipelineStatus.COMPLETE,
        screening=a_screening(), verification=a_verification(),
    )
    record_pipeline_result(db, paper, result)

    actors = [e.actor for e in db.events]
    assert actors == [ACTOR_AGENT_3, ACTOR_AGENT_4]


def test_a_failed_verification_leaves_agent_4_untouched(db, paper):
    """Agent 3's work is kept; Agent 4's columns stay null rather than being blanked."""
    result = PipelineResult(
        pmid="38221190", status=PipelineStatus.VERIFICATION_FAILED,
        screening=a_screening(), verification=None, verification_error="unreachable",
    )
    record_pipeline_result(db, paper, result)

    assert paper.draft_decision == "INCLUDE"
    assert paper.verified_decision is None
    assert [e.actor for e in db.events] == [ACTOR_AGENT_3]
