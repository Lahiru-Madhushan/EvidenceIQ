"""Orchestrates Agent 3 and Agent 4 over HTTP, and records what they each concluded.

The orchestrator holds no agent logic of its own. It calls POST /api/screen and then
POST /api/verify through AgentClient - the same REST endpoints any other client uses -
and its only real work is deciding what to do between and after those two calls:

* Agent 4 is given Agent 3's decision, but only for comparison; the verification agent
  withholds it from its own prompt (see app/agents/verification/agent.py). Calling them
  in sequence therefore does not make the second opinion any less independent.
* A failure in Agent 4 must not discard Agent 3's work. Screening is committed either
  way; only the verification columns are left null.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.paper import Paper as PaperModel
from app.models.paper_event import (
    ACTION_SCREENED,
    ACTION_VERIFIED,
    ACTOR_AGENT_3,
    ACTOR_AGENT_4,
    PaperEvent,
)
from app.schemas.paper import Paper
from app.schemas.pipeline import PipelineResult, PipelineStatus
from app.schemas.protocol import Protocol
from app.schemas.screening import ScreeningDecision
from app.schemas.verification import VerificationResult
from app.services.agent_client import AgentCallError, AgentClient

logger = logging.getLogger(__name__)


async def run_pipeline(
    paper: Paper,
    protocol: Protocol,
    client: AgentClient,
    *,
    paper_id=None,
) -> PipelineResult:
    """Screen one paper via Agent 3, then have Agent 4 independently verify that draft.

    Raises AgentCallError if Agent 3 could not be reached - with no draft there is
    nothing to verify, so there is no partial result worth returning. An Agent 4 failure
    is reported in the result instead, because by then Agent 3's decision is real.
    """
    screening = await client.screen(paper, protocol)

    try:
        verification = await client.verify(paper, protocol, screening)
    except AgentCallError as exc:
        logger.error("Agent 4 failed for pmid=%s after screening: %s", paper.pmid, exc)
        return PipelineResult(
            pmid=paper.pmid,
            paper_id=paper_id,
            status=PipelineStatus.VERIFICATION_FAILED,
            screening=screening,
            verification=None,
            verification_error=str(exc),
        )

    return PipelineResult(
        pmid=paper.pmid,
        paper_id=paper_id,
        status=PipelineStatus.COMPLETE,
        screening=screening,
        verification=verification,
    )


def paper_row_to_schema(row: PaperModel) -> Paper:
    """The stored row as the agents' input contract, with nulls normalised to blanks."""
    return Paper(
        pmid=row.pmid or "",
        title=row.title or "",
        abstract=row.abstract or "",
        year=row.year,
        journal=row.journal,
        publication_types=row.publication_types or [],
    )


def record_screening(db: Session, row: PaperModel, screening: ScreeningDecision) -> None:
    """Write Agent 3's columns, and log that Agent 3 ran. The caller commits.

    Touches only the draft_* columns - the set Agent 3 owns in the Database Guide's
    section 11 split. Kept separate from record_verification so that ownership is a
    property of the code rather than a promise in a comment: neither function can write
    another agent's fields, whatever calls them.
    """
    row.draft_decision = screening.decision.value
    row.draft_reason = screening.reason
    row.screened_at = datetime.now(timezone.utc)

    db.add(
        PaperEvent(
            paper_id=row.id,
            actor=ACTOR_AGENT_3,
            action=ACTION_SCREENED,
            detail={"decision": screening.decision.value, "reason": screening.reason},
        )
    )


def record_verification(
    db: Session, row: PaperModel, verification: VerificationResult
) -> None:
    """Write Agent 4's columns, and log that Agent 4 ran. The caller commits.

    Touches only the columns Agent 4 owns. The event's detail carries the checks as
    well as the verdict: `papers.checks` holds only the latest run, so without a
    snapshot here the evidence behind a superseded decision would be lost on a re-run -
    which is the precise thing this table exists to prevent.
    """
    row.verified_decision = verification.verified_decision.value
    row.confidence = verification.confidence.value
    row.agreement = verification.agreement
    row.needs_human_review = verification.needs_human_review
    row.verification_note = verification.verification_note
    row.checks = [check.model_dump(mode="json") for check in verification.checks]
    row.issues = list(verification.issues)
    row.verified_at = datetime.now(timezone.utc)

    db.add(
        PaperEvent(
            paper_id=row.id,
            actor=ACTOR_AGENT_4,
            action=ACTION_VERIFIED,
            detail={
                "verified_decision": verification.verified_decision.value,
                "screening_decision": verification.screening_decision.value,
                "agreement": verification.agreement,
                "confidence": verification.confidence.value,
                "needs_human_review": verification.needs_human_review,
                "note": verification.verification_note,
                "checks": [check.model_dump(mode="json") for check in verification.checks],
                "issues": list(verification.issues),
            },
        )
    )


def record_pipeline_result(db: Session, row: PaperModel, result: PipelineResult) -> None:
    """Persist whichever agents actually ran, each through its own writer.

    The orchestrator writes both agents' column sets because it genuinely ran both
    agents - but it does so by calling each agent's writer in turn, never by touching
    the columns itself. If Agent 4 failed there is no verification to record, and its
    columns are left untouched rather than blanked.
    """
    record_screening(db, row, result.screening)
    if result.verification is not None:
        record_verification(db, row, result.verification)
