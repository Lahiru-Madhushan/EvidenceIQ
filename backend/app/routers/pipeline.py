"""The orchestrator: the endpoints that make the agents talk to each other.

Agent communication protocol: REST API + JSON over HTTP. Every hand-off below is a real
HTTP request to another agent's FastAPI endpoint, carrying the caller's JWT, not an
in-process function call. See app/services/agent_client.py for why.

    POST /pipeline/run           Agent 3 -> Agent 4          (stateless, body in)
    POST /pipeline/paper/{id}    Agent 3 -> Agent 4          (one stored paper)
    POST /pipeline/review/{id}   Agent 3 -> Agent 4          (every paper in a review)
    POST /pipeline/full          Agent 1 -> 2 -> 3 -> 4      (the whole chain)

The single-agent endpoints (/screen, /verify, /criteria, /retrieval) are unchanged -
this router is a client of them, exactly like the frontend is.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_bearer_token, get_current_user
from app.models.paper import Paper as PaperModel
from app.models.review import Review as ReviewModel
from app.schemas.pipeline import (
    FullRunRequest,
    FullRunResponse,
    PipelineBatchResponse,
    PipelineItem,
    PipelineResult,
    PipelineRunRequest,
    PipelineStatus,
)
from app.schemas.protocol import Protocol
from app.services.agent_client import AgentCallError, AgentClient
from app.services.pipeline import (
    paper_row_to_schema,
    record_pipeline_result,
    record_screening,
    record_verification,
    run_batch,
    run_pipeline,
    run_screening_phase,
    run_verification_phase,
)
from app.schemas.screening import Decision, ScreeningDecision

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])

# Downstream statuses that describe the CALLER's mistake and stay true one hop up.
# Anything else (a 500, a connection error) becomes a 502: from the caller's point of
# view the orchestrator's dependency failed, which is what 502 means.
_PASS_THROUGH_STATUS = {400, 401, 403, 404, 422, 429, 502, 503, 504}


def _agent_failure(exc: AgentCallError) -> HTTPException:
    """Re-raise a downstream agent's failure without disguising it as our own."""
    code = exc.status_code if exc.status_code in _PASS_THROUGH_STATUS else 502
    return HTTPException(status_code=code, detail=str(exc))


def _client(token: str) -> AgentClient:
    return AgentClient(token)


def _load_owned_review(db: Session, review_id, user: dict) -> ReviewModel:
    """Fetch a review, or refuse it - RLS does not cover this connection, we check here."""
    review = db.get(ReviewModel, review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this review."
        )
    if not review.protocol:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This review has no protocol yet - Agent 1 must run first.",
        )
    return review


@router.post("/run", response_model=PipelineResult)
async def run_both(
    request: PipelineRunRequest,
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
) -> PipelineResult:
    """Agent 3 then Agent 4 over one paper from the request body. Nothing is stored."""
    if not request.paper.pmid.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="paper.pmid is required and cannot be blank.",
        )

    try:
        return await run_pipeline(request.paper, request.protocol, _client(token))
    except AgentCallError as exc:
        logger.error("Agent 3 failed for pmid=%s: %s", request.paper.pmid, exc)
        raise _agent_failure(exc) from exc


@router.post("/paper/{paper_id}", response_model=PipelineResult)
async def run_for_paper(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
) -> PipelineResult:
    """Agent 3 then Agent 4 over one stored paper, writing both agents' columns back."""
    row = db.get(PaperModel, paper_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    review = _load_owned_review(db, row.review_id, user)

    try:
        result = await run_pipeline(
            paper_row_to_schema(row),
            Protocol(**review.protocol),
            _client(token),
            paper_id=row.id,
        )
    except AgentCallError as exc:
        logger.error("Agent 3 failed for paper_id=%s: %s", paper_id, exc)
        raise _agent_failure(exc) from exc

    record_pipeline_result(db, row, result)
    db.commit()
    return result


@router.post("/review/{review_id}", response_model=PipelineBatchResponse)
async def run_for_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
    rerun: bool = Query(
        default=False,
        description=(
            "Re-run papers that already have a screening decision. Off by default so "
            "calling this twice does not spend the model quota twice."
        ),
    ),
) -> PipelineBatchResponse:
    """Run Agents 3 and 4 over every paper in one review.

    One paper failing does not sink the run: its slot carries an error and the rest are
    still screened, verified and saved, matching how /screen/batch and /verify/batch
    already behave.
    """
    review = _load_owned_review(db, review_id, user)
    protocol = Protocol(**review.protocol)
    client = _client(token)

    rows = _papers_to_screen(db, review_id, rerun=rerun)
    skipped = (
        db.query(PaperModel).filter(PaperModel.review_id == review_id).count() - len(rows)
    )

    # Agent 3 over every paper first, then Agent 4 over every draft - not one paper at
    # a time through both. See run_batch for why the order matters.
    async with client:
        pairs, stopped_reason = await run_batch(
            [(row, paper_row_to_schema(row)) for row in rows],
            protocol,
            client,
            concurrency=settings.verify_batch_concurrency,
        )

    # Committed once at the end rather than per paper: a single transaction means the
    # review never sits in a half-saved state if the process dies mid-run.
    for row, item in pairs:
        if item.result is not None:
            record_pipeline_result(db, row, item.result)
    db.commit()

    return _summarise([item for _, item in pairs], skipped, stopped_reason=stopped_reason)


@router.post("/review/{review_id}/screen", response_model=PipelineBatchResponse)
async def screen_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
    rerun: bool = Query(default=False, description="Re-screen papers already screened."),
) -> PipelineBatchResponse:
    """Phase 1 alone: Agent 3 over every unscreened paper in the review.

    Split out from the combined endpoint so a caller can see the screening pass finish.
    The two agents run in phases anyway (see run_batch); with one endpoint the client had
    no way to observe the boundary, so a UI could only claim both were running at once -
    which stopped being true the moment the phases were separated.

    The pass is committed here, before verification begins, which is the other reason to
    split it: Agent 3's work survives whatever Agent 4 does next.
    """
    review = _load_owned_review(db, review_id, user)
    protocol = Protocol(**review.protocol)
    rows = _papers_to_screen(db, review_id, rerun=rerun)

    async with _client(token) as client:
        drafts, stopped_reason = await run_screening_phase(
            [(row, paper_row_to_schema(row)) for row in rows],
            protocol,
            client,
            concurrency=settings.verify_batch_concurrency,
        )

    items: list[PipelineItem] = []
    for row, paper, decision, error, not_started in drafts:
        if decision is not None:
            record_screening(db, row, decision)
            items.append(
                PipelineItem(
                    pmid=paper.pmid,
                    paper_id=row.id,
                    result=PipelineResult(
                        pmid=paper.pmid,
                        paper_id=row.id,
                        status=PipelineStatus.VERIFICATION_FAILED,
                        screening=decision,
                    ),
                )
            )
        else:
            items.append(
                PipelineItem(
                    pmid=paper.pmid, paper_id=row.id, error=error, not_started=not_started
                )
            )
    db.commit()

    return _summarise(items, skipped=0, stopped_reason=stopped_reason)


@router.post("/review/{review_id}/verify", response_model=PipelineBatchResponse)
async def verify_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
    rerun: bool = Query(default=False, description="Re-verify papers already verified."),
) -> PipelineBatchResponse:
    """Phase 2 alone: Agent 4 over every screened paper that has no verification yet.

    Reads Agent 3's decision back off the row rather than taking it from the caller, so
    what gets verified is what was actually recorded.
    """
    review = _load_owned_review(db, review_id, user)
    protocol = Protocol(**review.protocol)

    query = db.query(PaperModel).filter(
        PaperModel.review_id == review_id, PaperModel.screened_at.isnot(None)
    )
    if not rerun:
        query = query.filter(PaperModel.verified_at.is_(None))
    rows = query.all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No screened papers are waiting for verification - Agent 3 must run first.",
        )

    drafts = [
        (row, paper_row_to_schema(row), _decision_from_row(row))
        for row in rows
        if _decision_from_row(row) is not None
    ]

    async with _client(token) as client:
        checked, stopped_reason = await run_verification_phase(
            drafts, protocol, client, concurrency=settings.verify_batch_concurrency
        )

    items: list[PipelineItem] = []
    for row, paper, decision in drafts:
        verification, error = checked.get(row, (None, None))
        if verification is not None:
            record_verification(db, row, verification)
        items.append(
            PipelineItem(
                pmid=paper.pmid,
                paper_id=row.id,
                result=PipelineResult(
                    pmid=paper.pmid,
                    paper_id=row.id,
                    status=(
                        PipelineStatus.COMPLETE
                        if verification is not None
                        else PipelineStatus.VERIFICATION_FAILED
                    ),
                    screening=decision,
                    verification=verification,
                    verification_error=error,
                ),
            )
        )
    db.commit()

    return _summarise(items, skipped=0, stopped_reason=stopped_reason)


def _papers_to_screen(db: Session, review_id, *, rerun: bool) -> list[PaperModel]:
    """The rows one screening pass should cover, or a 422 explaining why there are none."""
    all_rows = db.query(PaperModel).filter(PaperModel.review_id == review_id).all()
    if not all_rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This review has no papers yet - Agent 2 must run first.",
        )
    rows = all_rows if rerun else [row for row in all_rows if row.screened_at is None]
    if len(rows) > settings.verify_batch_max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"At most {settings.verify_batch_max} papers can be processed per request; "
                f"this review has {len(rows)} still to screen."
            ),
        )
    return rows


def _decision_from_row(row: PaperModel) -> ScreeningDecision | None:
    """Agent 3's recorded decision, as the schema Agent 4 expects."""
    if not row.draft_decision or row.draft_decision not in Decision.__members__:
        return None
    return ScreeningDecision(
        pmid=row.pmid or "",
        decision=Decision[row.draft_decision],
        reason=row.draft_reason or "",
    )


@router.post("/full", response_model=FullRunResponse)
async def run_full_chain(
    request: FullRunRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
) -> FullRunResponse:
    """The whole system in one call: Agent 1 -> Agent 2 -> Agent 3 -> Agent 4.

    Four HTTP hand-offs, each to a different agent's endpoint, each carrying the
    caller's JWT.

    Agent 1 is allowed to stop the chain. If the criteria are ambiguous it answers with
    a clarifying question instead of a protocol, and this returns at that point with the
    question: retrieving and screening against a protocol the researcher has not
    confirmed would produce confident, wrong results.
    """
    client = _client(token)

    # --- Agent 1: plain-language criteria -> structured protocol ------------------
    try:
        criteria = await client.submit_criteria(
            request.research_question, request.raw_criteria
        )
    except AgentCallError as exc:
        logger.error("Agent 1 failed: %s", exc)
        raise _agent_failure(exc) from exc

    review_id = criteria.get("review_id")
    if criteria.get("question") or criteria.get("ambiguous_term"):
        return FullRunResponse(
            review_id=review_id,
            stopped_at="Agent 1 (Criteria)",
            clarification_needed=True,
            ambiguous_term=criteria.get("ambiguous_term"),
            question=criteria.get("question"),
        )

    protocol_data = criteria.get("protocol")
    if not protocol_data:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Agent 1 returned neither a protocol nor a clarifying question.",
        )
    protocol = Protocol(**protocol_data)

    # --- Agent 2: protocol/query -> papers stored on the review -------------------
    try:
        retrieval = await client.retrieve(
            str(review_id),
            request.query or request.research_question,
            max_results=request.max_results,
            page_size=request.max_results,
            year_from=protocol.date_range.from_year if protocol.date_range else None,
            year_to=protocol.date_range.to_year if protocol.date_range else None,
        )
    except AgentCallError as exc:
        logger.error("Agent 2 failed for review_id=%s: %s", review_id, exc)
        raise _agent_failure(exc) from exc

    saved = int(retrieval.get("saved_count") or 0)
    if saved == 0:
        return FullRunResponse(
            review_id=review_id,
            protocol=protocol,
            stopped_at="Agent 2 (Retrieval)",
            total_found=int(retrieval.get("total_found") or 0),
            saved_count=0,
            message="No papers were saved, so there was nothing to screen.",
        )

    # --- Agents 3 and 4: screen every retrieved paper, then verify each draft -----
    rows = (
        db.query(PaperModel)
        .filter(PaperModel.review_id == review_id, PaperModel.screened_at.is_(None))
        .all()
    )
    # Agent 3 over every paper first, then Agent 4 over every draft - not one paper at
    # a time through both. See run_batch for why the order matters.
    async with client:
        pairs, stopped_reason = await run_batch(
            [(row, paper_row_to_schema(row)) for row in rows],
            protocol,
            client,
            concurrency=settings.verify_batch_concurrency,
        )
    for row, item in pairs:
        if item.result is not None:
            record_pipeline_result(db, row, item.result)
    db.commit()

    return FullRunResponse(
        review_id=review_id,
        protocol=protocol,
        stopped_at=None,
        total_found=int(retrieval.get("total_found") or 0),
        saved_count=saved,
        screening=_summarise(
            [item for _, item in pairs], skipped=0, stopped_reason=stopped_reason
        ),
    )


def _summarise(
    items: list[PipelineItem], skipped: int, *, stopped_reason: str | None = None
) -> PipelineBatchResponse:
    """Roll per-paper outcomes up into the counts a review dashboard needs."""
    done = [item.result for item in items if item.result is not None]
    verified = [r for r in done if r.verification is not None]

    return PipelineBatchResponse(
        total=len(items),
        not_started=sum(1 for item in items if item.not_started),
        stopped_reason=stopped_reason,
        complete=sum(1 for r in done if r.status is PipelineStatus.COMPLETE),
        verification_failed=sum(
            1 for r in done if r.status is PipelineStatus.VERIFICATION_FAILED
        ),
        # A paper the run never reached is not a paper that failed. Counting it as one
        # would report a quota that ran out at paper 3 as forty-seven broken papers.
        failed=sum(1 for item in items if item.error is not None and not item.not_started),
        included=sum(1 for r in done if r.screening.decision.value == "INCLUDE"),
        excluded=sum(1 for r in done if r.screening.decision.value == "EXCLUDE"),
        disagreements=sum(1 for r in verified if not r.verification.agreement),
        needs_human_review=sum(1 for r in verified if r.verification.needs_human_review),
        skipped=skipped,
        results=items,
    )
