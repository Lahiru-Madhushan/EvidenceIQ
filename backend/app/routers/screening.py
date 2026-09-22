"""Agent 3's REST surface - how a retrieved paper gets a draft screening decision.

Every endpoint requires the researcher's Supabase JWT, matching Agent 4's pattern:
a screening decision always runs on behalf of a known user, never anonymously.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.agents.screening.agent import screen
from app.core.config import settings
from app.core.security import get_current_user
from app.schemas.screening_request import (
    BatchScreenItem,
    BatchScreenRequest,
    BatchScreenResponse,
    ScreenRequest,
)
from app.schemas.screening import ScreeningDecision
from app.services.llm import LLMError, LLMQuotaExhausted
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone

from app.core.database import get_db
from app.models.paper import Paper as PaperModel
from app.models.review import Review as ReviewModel
from app.schemas.protocol import Protocol
from app.schemas.paper import Paper as PaperSchema
from app.services.pipeline import record_screening

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/screen", tags=["screening"])

# Reuses the same batch limits Agent 4 already defined - one paper cap for the
# whole screening/verification pipeline, not two numbers to keep in sync by hand.
_BATCH_MAX = settings.verify_batch_max
_BATCH_CONCURRENCY = settings.verify_batch_concurrency


@router.post("", response_model=ScreeningDecision)
async def screen_paper(
    request: ScreenRequest,
    user: dict = Depends(get_current_user),
) -> ScreeningDecision:
    """Produce a draft Include/Exclude decision for one paper against one protocol."""
    if not request.paper.pmid.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="paper.pmid is required and cannot be blank.",
        )

    try:
        return await screen(request.paper, request.protocol)
    except LLMQuotaExhausted as exc:
        # See the matching handler in routers/verification.py: a spent quota is a 429
        # with its own reason, not a 502 with a borrowed one.
        logger.warning("Screening quota exhausted for pmid=%s: %s", request.paper.pmid, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Screening failed for pmid=%s: %s", request.paper.pmid, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The screening model is unavailable. No decision was recorded.",
        ) from exc


@router.post("/batch", response_model=BatchScreenResponse)
async def screen_batch(
    request: BatchScreenRequest,
    user: dict = Depends(get_current_user),
) -> BatchScreenResponse:
    """Screen a page of retrieved papers under one protocol.

    One paper failing does not sink the batch: its slot carries an error and the
    rest are returned, matching Agent 4's batch behaviour.
    """
    if not request.papers:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No papers were supplied.",
        )
    if len(request.papers) > _BATCH_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"At most {_BATCH_MAX} papers can be screened per request; "
                f"received {len(request.papers)}."
            ),
        )

    blank_pmids = [i for i, paper in enumerate(request.papers) if not paper.pmid.strip()]
    if blank_pmids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"papers[{blank_pmids[0]}].pmid is required and cannot be blank.",
        )

    semaphore = asyncio.Semaphore(_BATCH_CONCURRENCY)

    async def run_one(paper) -> BatchScreenItem:
        async with semaphore:
            try:
                result = await screen(paper, request.protocol)
                return BatchScreenItem(pmid=paper.pmid, result=result)
            except LLMError as exc:
                logger.error("Screening failed for pmid=%s: %s", paper.pmid, exc)
                return BatchScreenItem(pmid=paper.pmid, error=str(exc))

    results = await asyncio.gather(*(run_one(paper) for paper in request.papers))

    completed = [item.result for item in results if item.result is not None]
    return BatchScreenResponse(
        total=len(results),
        included=sum(1 for result in completed if result.decision.value == "INCLUDE"),
        excluded=sum(1 for result in completed if result.decision.value == "EXCLUDE"),
        failed=sum(1 for item in results if item.error is not None),
        results=list(results),
    )

@router.post("/by-id/{paper_id}", response_model=ScreeningDecision)
async def screen_paper_by_id(
    paper_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ScreeningDecision:
    """Screen a paper already stored in the database, and save the decision back.

    Ownership check: a user may only screen papers that belong to a review they
    own - RLS does not protect this backend connection, so we check it ourselves
    (see the team's Database Guide, section 9).
    """
    paper_row = db.get(PaperModel, paper_id)
    if paper_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    review_row = db.get(ReviewModel, paper_row.review_id)
    if review_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    if str(review_row.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this review.")

    if not review_row.protocol:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This review has no protocol yet - Agent 1 must run first.",
        )

    paper = PaperSchema(
        pmid=paper_row.pmid or "",
        title=paper_row.title or "",
        abstract=paper_row.abstract or "",
        year=paper_row.year,
        journal=paper_row.journal,
        publication_types=paper_row.publication_types or [],
    )
    protocol = Protocol(**review_row.protocol)

    try:
        result = await screen(paper, protocol)
    except LLMQuotaExhausted as exc:
        # Must come before the LLMError branch below - LLMQuotaExhausted subclasses it,
        # so a bare `except LLMError` reports a spent quota as 502 "model unavailable".
        # A caller driving the agents one paper at a time reads that status to decide
        # whether to fetch another paper, and 502 tells it to keep trying against a
        # budget that is gone.
        logger.warning("Screening quota exhausted for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Screening failed for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The screening model is unavailable. No decision was recorded.",
        ) from exc

    # Writes our columns and the audit event through the canonical writer (Database
    # Guide section 11 - never touch another agent's). This used to set the three
    # columns inline and commit, which worked but recorded no paper_events row - so a
    # paper screened through this endpoint had no audit trail, while the same paper
    # screened through the batch pipeline did. Driving the agents one paper at a time
    # makes this the normal path rather than a rarely used one, so the gap would have
    # become the rule.
    record_screening(db, paper_row, result)
    db.commit()

    return result