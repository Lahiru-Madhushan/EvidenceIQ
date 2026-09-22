"""Agent 4's REST surface - how Agent 3 hands work to the Verification Agent.

Every endpoint requires the researcher's Supabase JWT. Agent 3 forwards the token it was
called with, so a verification always runs on behalf of a known user rather than as an
anonymous service call.

    POST /verify              stateless - the caller supplies the paper and the draft
    POST /verify/batch        a page of drafts at once
    POST /verify/by-id/{id}   one stored row, read and written in place
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.agents.verification import verify
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.paper import Paper as PaperModel
from app.models.review import Review as ReviewModel
from app.schemas.protocol import Protocol
from app.schemas.verification import (
    BatchVerifyItem,
    BatchVerifyRequest,
    BatchVerifyResponse,
    VerificationResult,
    VerifyRequest,
)
from app.services.llm import LLMError, LLMQuotaExhausted
from app.services.pipeline import (
    decision_from_row,
    paper_row_to_schema,
    record_verification,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/verify", tags=["verification"])


@router.post("", response_model=VerificationResult)
async def verify_paper(
    request: VerifyRequest,
    user: dict = Depends(get_current_user),
) -> VerificationResult:
    """Independently verify one screened paper against the protocol."""
    try:
        return await verify(request)
    except LLMQuotaExhausted as exc:
        # 429, not 502. A spent quota is not a broken dependency: it has a cause, an
        # owner and a reset time, and the message already says all three - so it is
        # passed through rather than replaced with a generic one. The orchestrator
        # forwards 429 unchanged (see _PASS_THROUGH_STATUS) so this reaches the caller.
        logger.warning("Verification quota exhausted for pmid=%s: %s", request.paper.pmid, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Verification failed for pmid=%s: %s", request.paper.pmid, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The verification model is unavailable. No decision was recorded.",
        ) from exc


@router.post("/batch", response_model=BatchVerifyResponse)
async def verify_batch(
    request: BatchVerifyRequest,
    user: dict = Depends(get_current_user),
) -> BatchVerifyResponse:
    """Verify a page of screened papers under one protocol.

    One paper failing does not sink the batch: its slot carries an error and the rest
    are returned, so a researcher never loses a whole screening run to one bad call.
    """
    if not request.items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No papers were supplied.",
        )
    if len(request.items) > settings.verify_batch_max:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"At most {settings.verify_batch_max} papers can be verified per request; "
                f"received {len(request.items)}."
            ),
        )

    semaphore = asyncio.Semaphore(settings.verify_batch_concurrency)

    async def run_one(item) -> BatchVerifyItem:
        async with semaphore:
            single = VerifyRequest(
                paper=item.paper,
                protocol=request.protocol,
                screening_decision=item.screening_decision,
            )
            try:
                return BatchVerifyItem(pmid=item.paper.pmid, result=await verify(single))
            except LLMError as exc:
                logger.error("Verification failed for pmid=%s: %s", item.paper.pmid, exc)
                return BatchVerifyItem(pmid=item.paper.pmid, error=str(exc))

    results = await asyncio.gather(*(run_one(item) for item in request.items))

    completed = [item.result for item in results if item.result is not None]
    return BatchVerifyResponse(
        total=len(results),
        verified=sum(1 for result in completed if result.agreement),
        disagreements=sum(1 for result in completed if not result.agreement),
        needs_human_review=sum(1 for result in completed if result.needs_human_review),
        failed=sum(1 for item in results if item.error is not None),
        results=list(results),
    )


@router.post("/by-id/{paper_id}", response_model=VerificationResult)
async def verify_paper_by_id(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> VerificationResult:
    """Verify one stored paper, and save Agent 4's columns back.

    The mirror of Agent 3's POST /screen/by-id, and the other half of what a caller
    needs to run the two agents one paper at a time: screen a row, verify that row, then
    decide whether to fetch another. The batch endpoints cannot answer that question,
    because they only return once a whole page has been processed - so a caller chasing
    a target number of accepted papers had no way to stop at the moment it was reached.

    Agent 3's decision is read back off the row rather than taken from the caller, so
    what gets verified is what was actually recorded. It is used only for the comparison;
    the verification agent withholds it from its own prompt, so running second does not
    make the second opinion any less independent.
    """
    row = db.get(PaperModel, paper_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    review = db.get(ReviewModel, row.review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    # RLS does not cover this connection (Database Guide section 9), so ownership is
    # checked here exactly as every other stored-row endpoint checks it.
    if str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this review."
        )

    if not review.protocol:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This review has no protocol yet - Agent 1 must run first.",
        )

    screening_decision = decision_from_row(row)
    if screening_decision is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This paper has no screening decision yet - Agent 3 must run first.",
        )

    request = VerifyRequest(
        paper=paper_row_to_schema(row),
        protocol=Protocol(**review.protocol),
        screening_decision=screening_decision,
    )

    try:
        result = await verify(request)
    except LLMQuotaExhausted as exc:
        logger.warning("Verification quota exhausted for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Verification failed for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The verification model is unavailable. No decision was recorded.",
        ) from exc

    # Writes Agent 4's columns and the audit event through the canonical writer, so this
    # endpoint cannot touch another agent's fields even by accident.
    record_verification(db, row, result)
    db.commit()

    return result
