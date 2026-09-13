"""Review lifecycle - the bit that is nobody's agent.

`reviews.status` was only ever written by Agent 1, which set it to "screening" the moment
it produced a protocol. That made it mean "Agent 1 finished", not "where this review has
got to", and nothing in the codebase ever wrote "complete" - so a review entered
screening and could never leave it.

Recomputing it from the papers is deliberately a backend endpoint rather than a browser
write: `reviews.status` is not the researcher's column to set (Database Guide section 11),
and deriving it in one place keeps the rule from drifting between callers.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.paper import Paper as PaperModel
from app.models.review import Review as ReviewModel
from app.schemas.review import ReviewStatusResponse

router = APIRouter(prefix="/reviews", tags=["reviews"])


def derive_status(review: ReviewModel, total: int, decided: int) -> str:
    """What this review's status should be, given the papers under it.

    Leaves the pre-protocol states alone. `draft` and `awaiting_clarification` describe
    Agent 1's progress, and Agent 1 is the only thing that can move a review out of them -
    a paper count says nothing about whether the criteria have been interpreted yet.
    """
    if not review.protocol:
        return review.status or "draft"

    # Every paper decided by a human is the only thing that finishes a review. Zero papers
    # is not complete: there is nothing to have finished.
    if total > 0 and decided == total:
        return "complete"
    return "screening"


@router.post("/{review_id}/status", response_model=ReviewStatusResponse)
def refresh_status(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ReviewStatusResponse:
    """Recompute this review's status from its papers, and save it if it changed.

    Idempotent, and safe to call after any decision: it recomputes rather than advancing
    a state machine, so a researcher undoing a decision moves the review back out of
    `complete` just as reliably as finishing one moved it in.
    """
    review = db.get(ReviewModel, review_id)
    if review is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN, detail="You do not own this review."
        )

    total, screened, decided = db.query(
        func.count(PaperModel.id),
        func.count(PaperModel.screened_at),
        func.count(PaperModel.researcher_status),
    ).filter(PaperModel.review_id == review_id).one()

    previous = review.status
    new_status = derive_status(review, total, decided)
    if new_status != previous:
        review.status = new_status
        db.commit()

    return ReviewStatusResponse(
        review_id=review.id,
        status=new_status,
        changed=new_status != previous,
        total_papers=total,
        screened_papers=screened,
        decided_papers=decided,
    )
