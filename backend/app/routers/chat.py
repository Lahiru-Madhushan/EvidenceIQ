"""Ask questions about one paper, answered only from what the review already holds.

Deliberately not under /api/pipeline: this decides nothing and writes nothing. It reads
a paper the researcher already owns and answers questions about it, and a question that
the paper does not answer comes back as a refusal rather than a guess.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.paper import Paper as PaperModel
from app.models.review import Review as ReviewModel
from app.schemas.chat import PaperChatRequest, PaperChatResponse, PaperSummary
from app.services.llm import LLMError, LLMQuotaExhausted
from app.services.paper_chat import answer_question, summarise

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/papers", tags=["chat"])


def _load_owned_paper(db: Session, paper_id: uuid.UUID, user: dict) -> tuple[PaperModel, ReviewModel]:
    """The paper and its review, or a refusal. Ownership is checked here, not by RLS."""
    row = db.get(PaperModel, paper_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")

    review = db.get(ReviewModel, row.review_id)
    if review is None or str(review.owner_id) != str(user.get("sub")):
        # Same answer for "not yours" as for "does not exist": otherwise this endpoint
        # would confirm which paper ids are real to anyone who asks.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found.")
    return row, review


def _as_dict(row: PaperModel) -> dict:
    return {
        "pmid": row.pmid,
        "title": row.title,
        "abstract": row.abstract,
        "journal": row.journal,
        "year": row.year,
        "publication_types": row.publication_types or [],
        "draft_decision": row.draft_decision,
        "draft_reason": row.draft_reason,
        "verified_decision": row.verified_decision,
        "confidence": row.confidence,
        "verification_note": row.verification_note,
        "checks": row.checks or [],
        "issues": row.issues or [],
    }


@router.get("/{paper_id}/summary", response_model=PaperSummary)
def paper_summary(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> PaperSummary:
    """The short orientation shown above the chat. Costs no model call."""
    row, _ = _load_owned_paper(db, paper_id, user)
    return PaperSummary(**summarise(_as_dict(row)))


@router.post("/{paper_id}/chat", response_model=PaperChatResponse)
async def chat_with_paper(
    paper_id: uuid.UUID,
    request: PaperChatRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> PaperChatResponse:
    """Answer one question about one paper, from that paper alone."""
    row, review = _load_owned_paper(db, paper_id, user)

    if not (row.abstract or "").strip() and not row.checks:
        # Nothing to ground an answer in. Better to say that once than to let the model
        # be asked questions about an empty context over and over.
        return PaperChatResponse(
            answer=(
                "There is no abstract stored for this paper and it has not been screened "
                "yet, so there is nothing here for me to read. Open it on PubMed instead."
            ),
            grounded=False,
        )

    try:
        result = await answer_question(
            paper=_as_dict(row),
            protocol=review.protocol or None,
            question=request.question,
            history=[turn.model_dump() for turn in request.history],
        )
    except LLMQuotaExhausted as exc:
        logger.warning("Paper chat quota exhausted for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Paper chat failed for paper_id=%s: %s", paper_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The chat model is unavailable. No answer was produced.",
        ) from exc

    return PaperChatResponse(**result)
