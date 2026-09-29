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

import asyncio
import logging
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

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
from app.schemas.pipeline import PipelineItem, PipelineResult, PipelineStatus
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import VerificationResult
from app.services.agent_client import AgentCallError, AgentClient, public_error

logger = logging.getLogger(__name__)


class QuotaGate:
    """Shared across one batch: the first spent quota stops the rest of the run.

    A token quota is an account-wide fact, so once one paper has proved it is gone,
    every remaining paper in the batch already knows its own outcome. Letting them find
    out individually is not merely slow - each one first spends Agent 3's quota on a
    screening decision whose verification cannot follow, so the run converts the budget
    that is left into half-finished papers.

    Screening results already committed stay committed; this only stops new work.
    """

    def __init__(self) -> None:
        self.reason: str | None = None

    @property
    def tripped(self) -> bool:
        return self.reason is not None

    def trip(self, reason: str) -> None:
        if self.reason is None:
            logger.warning("Stopping the run early: %s", reason)
            self.reason = reason

    # Conditions that belong to the run rather than to one paper, so the next paper
    # already knows its own outcome. 429 is a spent quota. 401 and 403 are the
    # researcher's token: it is forwarded on every hop, and a long batch can outlive it,
    # after which every remaining paper fails identically on an expired signature. That
    # is one fact about the run, not forty-eight broken papers, and re-running after
    # signing in fixes all of them at once.
    _RUN_WIDE_STATUS = {401, 403, 429}

    def consider(self, exc: AgentCallError) -> None:
        """Trip on the failures that cannot come out differently for the next paper."""
        if exc.status_code in self._RUN_WIDE_STATUS:
            self.trip(public_error(exc))


Draft = tuple[Any, Paper, "ScreeningDecision | None", "str | None", bool]


async def run_screening_phase(
    entries: Sequence[tuple[Any, Paper]],
    protocol: Protocol,
    client: AgentClient,
    *,
    concurrency: int,
) -> tuple[list[Draft], str | None]:
    """Agent 3 over every paper. Returns (key, paper, decision, error, not_started).

    Separated from verification so a caller can commit and report the screening pass on
    its own. That is not only a progress-reporting convenience: the pass is a coherent
    state - every paper carries a draft decision - so saving it before Agent 4 starts
    means a verification failure can no longer cost the researcher work Agent 3 already
    did and already paid for.
    """
    gate = QuotaGate()
    semaphore = asyncio.Semaphore(concurrency)

    async def screen_one(key: Any, paper: Paper) -> Draft:
        async with semaphore:
            if gate.tripped:
                return key, paper, None, gate.reason, True
            try:
                return key, paper, await client.screen(paper, protocol), None, False
            except AgentCallError as exc:
                gate.consider(exc)
                logger.error("Agent 3 failed for pmid=%s: %s", paper.pmid, exc)
                return key, paper, None, public_error(exc), False

    drafts = list(await asyncio.gather(*(screen_one(k, p) for k, p in entries)))
    done = sum(1 for _, _, decision, _, _ in drafts if decision is not None)
    logger.info("Screening pass complete: %d of %d papers.", done, len(entries))
    return drafts, gate.reason


async def run_verification_phase(
    drafts: Sequence[tuple[Any, Paper, ScreeningDecision]],
    protocol: Protocol,
    client: AgentClient,
    *,
    concurrency: int,
) -> tuple[dict[Any, tuple[VerificationResult | None, str | None]], str | None]:
    """Agent 4 over every draft, keyed so the caller can match results back to papers.

    Agent 3's decision is passed in for the comparison only - the verification agent
    withholds it from its own prompt, so running second does not make the second opinion
    any less independent.
    """
    gate = QuotaGate()
    semaphore = asyncio.Semaphore(concurrency)

    async def verify_one(key: Any, paper: Paper, decision: ScreeningDecision):
        async with semaphore:
            if gate.tripped:
                return key, None, gate.reason
            try:
                return key, await client.verify(paper, protocol, decision), None
            except AgentCallError as exc:
                gate.consider(exc)
                logger.error("Agent 4 failed for pmid=%s: %s", paper.pmid, exc)
                return key, None, public_error(exc)

    results = await asyncio.gather(*(verify_one(k, p, d) for k, p, d in drafts))
    logger.info(
        "Verification pass complete: %d of %d drafts.",
        sum(1 for _, verification, _ in results if verification is not None),
        len(drafts),
    )
    return {key: (verification, error) for key, verification, error in results}, gate.reason


async def run_batch(
    entries: Sequence[tuple[Any, Paper]],
    protocol: Protocol,
    client: AgentClient,
    *,
    concurrency: int,
) -> tuple[list[tuple[Any, PipelineItem]], str | None]:
    """Screen every paper, then verify every draft. Two phases, in that order.

    Running the agents in phases rather than paper-by-paper matters because their quotas
    are separate - Agent 3 and Agent 4 are on different models by design. Interleaved,
    Agent 4 running out stopped the run while papers Agent 3 could still afford to screen
    went untouched, so a spent verification quota cost the researcher their screening
    results too. In phases, Agent 3 finishes its pass on its own budget whatever Agent 4
    can or cannot do afterwards, and the second opinion fills in behind it.

    It also matches what the two agents mean. Verification is a review of a completed
    screening pass, so a run that screens everything and verifies most of it is a
    partially reviewed pass - a state a researcher can read and act on. The interleaved
    version produced something with no name: some papers finished, some never looked at.

    Each phase has its own quota gate, because one model's exhausted budget says nothing
    about the other's.

    Returns the per-paper items in the caller's original order, paired with the reason
    the run stopped early if it did.
    """
    drafts, screen_reason = await run_screening_phase(
        entries, protocol, client, concurrency=concurrency
    )
    verifiable = [
        (key, paper, decision)
        for key, paper, decision, _, _ in drafts
        if decision is not None
    ]
    checked, verify_reason = await run_verification_phase(
        verifiable, protocol, client, concurrency=concurrency
    )

    # --- Assemble, in the caller's original order ------------------------------------
    items: list[tuple[Any, PipelineItem]] = []
    for key, paper, decision, error, not_started in drafts:
        paper_id = key.id if hasattr(key, "id") else None
        if decision is None:
            items.append(
                (
                    key,
                    PipelineItem(
                        pmid=paper.pmid,
                        paper_id=paper_id,
                        error=error,
                        not_started=not_started,
                    ),
                )
            )
            continue

        verification, verify_error = checked.get(key, (None, None))
        items.append(
            (
                key,
                PipelineItem(
                    pmid=paper.pmid,
                    paper_id=paper_id,
                    result=PipelineResult(
                        pmid=paper.pmid,
                        paper_id=paper_id,
                        status=(
                            PipelineStatus.COMPLETE
                            if verification is not None
                            else PipelineStatus.VERIFICATION_FAILED
                        ),
                        screening=decision,
                        verification=verification,
                        verification_error=verify_error,
                    ),
                ),
            )
        )

    return items, screen_reason or verify_reason


async def run_pipeline(
    paper: Paper,
    protocol: Protocol,
    client: AgentClient,
    *,
    paper_id=None,
    gate: QuotaGate | None = None,
) -> PipelineResult:
    """Screen one paper via Agent 3, then have Agent 4 independently verify that draft.

    Raises AgentCallError if Agent 3 could not be reached - with no draft there is
    nothing to verify, so there is no partial result worth returning. An Agent 4 failure
    is reported in the result instead, because by then Agent 3's decision is real.
    """
    try:
        screening = await client.screen(paper, protocol)
    except AgentCallError as exc:
        if gate is not None:
            gate.consider(exc)
        raise

    try:
        verification = await client.verify(paper, protocol, screening)
    except AgentCallError as exc:
        if gate is not None:
            gate.consider(exc)
        logger.error("Agent 4 failed for pmid=%s after screening: %s", paper.pmid, exc)
        return PipelineResult(
            pmid=paper.pmid,
            paper_id=paper_id,
            status=PipelineStatus.VERIFICATION_FAILED,
            screening=screening,
            verification=None,
            verification_error=public_error(exc),
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


def decision_from_row(row: PaperModel) -> ScreeningDecision | None:
    """Agent 3's recorded decision, as the schema Agent 4 expects.

    Returns None when Agent 3 has not ruled on this row yet, or wrote a value the
    Decision enum no longer recognises. Lives here rather than in a router because both
    the orchestrator's verification phase and Agent 4's own per-paper endpoint read a
    draft back off the row, and they must read it the same way.
    """
    if not row.draft_decision or row.draft_decision not in Decision.__members__:
        return None
    return ScreeningDecision(
        pmid=row.pmid or "",
        decision=Decision[row.draft_decision],
        reason=row.draft_reason or "",
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
            detail={
                "decision": screening.decision.value,
                "reason": screening.reason,
                # Kept in the audit trail: a paper that tried to instruct the model, or
                # had no abstract, is exactly what an auditor needs to be able to find.
                "flags": list(screening.flags),
                "needs_human_review": screening.needs_human_review,
                "model": screening.model,
            },
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
                # Which model answered. `papers` has no column for it, so the event is
                # the only place it survives - and with a fallback chain it is no longer
                # constant across a review, so "what verified this paper" stops being
                # answerable from the config alone.
                "model": verification.model,
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
