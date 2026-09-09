"""Agent 4's REST surface - how Agent 3 hands work to the Verification Agent.

Both endpoints require the researcher's Supabase JWT. Agent 3 forwards the token it was
called with, so a verification always runs on behalf of a known user rather than as an
anonymous service call.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.agents.verification import verify
from app.core.config import settings
from app.core.security import get_current_user
from app.schemas.verification import (
    BatchVerifyItem,
    BatchVerifyRequest,
    BatchVerifyResponse,
    VerificationResult,
    VerifyRequest,
)
from app.services.llm import LLMError

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
