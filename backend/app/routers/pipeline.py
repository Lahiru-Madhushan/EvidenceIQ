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

import asyncio
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
    run_pipeline,
)

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

    all_rows = db.query(PaperModel).filter(PaperModel.review_id == review_id).all()
    if not all_rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This review has no papers yet - Agent 2 must run first.",
        )

    rows = all_rows if rerun else [row for row in all_rows if row.screened_at is None]
    skipped = len(all_rows) - len(rows)

    if len(rows) > settings.verify_batch_max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"At most {settings.verify_batch_max} papers can be processed per request; "
                f"this review has {len(rows)} still to screen."
            ),
        )

    semaphore = asyncio.Semaphore(settings.verify_batch_concurrency)

    async def run_one(row: PaperModel) -> tuple[PaperModel, PipelineItem]:
        async with semaphore:
            try:
                result = await run_pipeline(
                    paper_row_to_schema(row), protocol, client, paper_id=row.id
                )
                return row, PipelineItem(pmid=row.pmid or "", paper_id=row.id, result=result)
            except AgentCallError as exc:
                logger.error("Agent 3 failed for paper_id=%s: %s", row.id, exc)
                return row, PipelineItem(pmid=row.pmid or "", paper_id=row.id, error=str(exc))

    pairs = await asyncio.gather(*(run_one(row) for row in rows))

    # Committed once at the end rather than per paper: a single transaction means the
    # review never sits in a half-saved state if the process dies mid-run.
    for row, item in pairs:
        if item.result is not None:
            record_pipeline_result(db, row, item.result)
    db.commit()

    return _summarise([item for _, item in pairs], skipped)


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
    semaphore = asyncio.Semaphore(settings.verify_batch_concurrency)

    async def run_one(row: PaperModel) -> tuple[PaperModel, PipelineItem]:
        async with semaphore:
            try:
                result = await run_pipeline(
                    paper_row_to_schema(row), protocol, client, paper_id=row.id
                )
                return row, PipelineItem(pmid=row.pmid or "", paper_id=row.id, result=result)
            except AgentCallError as exc:
                logger.error("Agent 3 failed for paper_id=%s: %s", row.id, exc)
                return row, PipelineItem(pmid=row.pmid or "", paper_id=row.id, error=str(exc))

    pairs = await asyncio.gather(*(run_one(row) for row in rows))
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
        screening=_summarise([item for _, item in pairs], skipped=0),
    )


def _summarise(items: list[PipelineItem], skipped: int) -> PipelineBatchResponse:
    """Roll per-paper outcomes up into the counts a review dashboard needs."""
    done = [item.result for item in items if item.result is not None]
    verified = [r for r in done if r.verification is not None]

    return PipelineBatchResponse(
        total=len(items),
        complete=sum(1 for r in done if r.status is PipelineStatus.COMPLETE),
        verification_failed=sum(
            1 for r in done if r.status is PipelineStatus.VERIFICATION_FAILED
        ),
        failed=sum(1 for item in items if item.error is not None),
        included=sum(1 for r in done if r.screening.decision.value == "INCLUDE"),
        excluded=sum(1 for r in done if r.screening.decision.value == "EXCLUDE"),
        disagreements=sum(1 for r in verified if not r.verification.agreement),
        needs_human_review=sum(1 for r in verified if r.verification.needs_human_review),
        skipped=skipped,
        results=items,
    )
