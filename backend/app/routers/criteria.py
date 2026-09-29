import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.paper import Paper
from app.models.review import Review
from app.schemas.review import (
    CriteriaSubmitRequest,
    ClarificationAnswerRequest,
    ClarificationNeededResponse,
    ProtocolReadyResponse,
    ReviewResponse,
    ReviewUpdateRequest,
    ReviewUpdatedResponse,
)
from app.services.user_data import delete_review_rows
from app.services.criteria_agent import (
    CriteriaAgentError,
    CriteriaQuotaExhausted,
    interpret_criteria,
)

# Authenticated at the router level, so a handler added here later is protected by
# default and has to opt out on purpose. Two handlers below once shipped without the
# dependency and served every review in the database to anyone (V-01 in the security
# assessment); a per-handler check is exactly the kind that gets forgotten.
router = APIRouter(
    prefix="/criteria",
    tags=["criteria-agent"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/submit")
async def submit_criteria(
    payload: CriteriaSubmitRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    First step: researcher submits a research question + raw criteria.
    Creates a new review row and runs it through the Criteria Agent.
    """
    try:
        result = await interpret_criteria(
            research_question=payload.research_question,
            raw_criteria=payload.raw_criteria,
        )
    except CriteriaQuotaExhausted as exc:
        # 429, matching Agents 3 and 4: the message already names the cause, the owner
        # and the reset time, so it is passed through rather than replaced.
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except CriteriaAgentError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    review = Review(
        owner_id=uuid.UUID(user["sub"]),
        research_question=payload.research_question,
        raw_criteria=payload.raw_criteria,
    )

    if result["status"] == "clarification_needed":
        review.status = "awaiting_clarification"
        db.add(review)
        db.commit()
        db.refresh(review)
        return ClarificationNeededResponse(
            review_id=review.id,
            ambiguous_term=result["ambiguous_term"],
            question=result["question"],
        )

    elif result["status"] == "ready":
        review.status = "screening"
        review.protocol = result["protocol"]
        db.add(review)
        db.commit()
        db.refresh(review)
        return ProtocolReadyResponse(review_id=review.id, protocol=review.protocol)

    else:
        raise HTTPException(status_code=500, detail="Unexpected response from Criteria Agent")


@router.post("/clarify")
async def submit_clarification(
    payload: ClarificationAnswerRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    Second step (only if needed): researcher answers a clarification question.
    Re-runs interpretation with the answer included, and finalizes the protocol.
    """
    review = db.get(Review, payload.review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    # Without this, anyone holding a review's UUID could answer someone else's
    # clarification and set the protocol their papers are screened against. RLS does not
    # cover this connection (Database Guide section 9), so the check has to be here.
    if str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=403, detail="You do not own this review.")

    clarification_context = f"Researcher's clarification: {payload.answer}"
    try:
        result = await interpret_criteria(
            research_question=review.research_question,
            raw_criteria=review.raw_criteria or "",
            clarification_context=clarification_context,
        )
    except CriteriaQuotaExhausted as exc:
        # 429, matching Agents 3 and 4: the message already names the cause, the owner
        # and the reset time, so it is passed through rather than replaced.
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except CriteriaAgentError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if result["status"] == "ready":
        review.status = "screening"
        review.protocol = result["protocol"]
        db.commit()
        db.refresh(review)
        return ProtocolReadyResponse(review_id=review.id, protocol=review.protocol)

    else:
        review.status = "awaiting_clarification"
        db.commit()
        return ClarificationNeededResponse(
            review_id=review.id,
            ambiguous_term=result.get("ambiguous_term", "unknown"),
            question=result.get("question", "Could you clarify further?"),
        )


@router.get("/{review_id}", response_model=ReviewResponse)
def get_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Fetch one of the caller's own reviews by ID."""
    review = db.get(Review, review_id)
    # 404 for "not yours" as well as "not found", as in the chat routers: a distinct 403
    # would confirm which review ids exist.
    if review is None or str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.get("/", response_model=list[ReviewResponse])
def list_reviews(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List the reviews owned by the caller, newest first."""
    return (
        db.query(Review)
        .filter(Review.owner_id == uuid.UUID(str(user["sub"])))
        .order_by(Review.created_at.desc())
        .all()
    )


@router.put("/{review_id}", response_model=ReviewUpdatedResponse)
async def update_review(
    review_id: uuid.UUID,
    payload: ReviewUpdateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Change a review's question or criteria, and re-run Agent 1 over the result.

    Editing the criteria means the rules change, so the old protocol cannot stand - but
    clearing it without producing a new one would leave the review unusable, with nothing
    for Agents 2-4 to screen against. So this re-interprets rather than just resetting,
    and can come back asking for clarification exactly as /submit does.

    Papers already screened keep their decisions. Those were reached against the previous
    protocol and are now stale, but draft_* and verified_* belong to Agents 3 and 4
    (Database Guide section 11) - so they are counted and reported, and the researcher
    re-runs screening to bring them up to date.
    """
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    if str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=403, detail="You do not own this review.")

    question = (payload.research_question or review.research_question or "").strip()
    criteria = (payload.raw_criteria or review.raw_criteria or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="A research question is required.")
    if not criteria:
        raise HTTPException(
            status_code=422,
            detail="Criteria are required - Agent 1 has nothing to interpret without them.",
        )

    try:
        result = await interpret_criteria(research_question=question, raw_criteria=criteria)
    except CriteriaQuotaExhausted as exc:
        # 429, matching Agents 3 and 4: the message already names the cause, the owner
        # and the reset time, so it is passed through rather than replaced.
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except CriteriaAgentError as exc:
        # Nothing is written on failure: a half-edited review with no protocol is worse
        # than an unchanged one.
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    stale = (
        db.query(Paper)
        .filter(Paper.review_id == review_id, Paper.screened_at.isnot(None))
        .count()
    )

    review.research_question = question
    review.raw_criteria = criteria

    if result["status"] == "clarification_needed":
        review.status = "awaiting_clarification"
        review.protocol = None
        db.commit()
        return ReviewUpdatedResponse(
            status="clarification_needed",
            review_id=review.id,
            ambiguous_term=result.get("ambiguous_term", "unknown"),
            question=result.get("question", "Could you clarify further?"),
            stale_screened_count=stale,
        )

    if result["status"] == "ready":
        review.status = "screening"
        review.protocol = result["protocol"]
        db.commit()
        return ReviewUpdatedResponse(
            status="ready",
            review_id=review.id,
            protocol=review.protocol,
            stale_screened_count=stale,
        )

    raise HTTPException(status_code=502, detail="Unexpected response from the Criteria Agent.")

@router.delete("/{review_id}")
def delete_review(
    review_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete one of the caller's reviews, with its papers and their audit events.

    A researcher could delete a chat but never a review, so a research question once
    entered stayed in the system for good. Same 404 for "not yours" as for "not found".
    """
    review = db.get(Review, review_id)
    if review is None or str(review.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=404, detail="Review not found")
    papers_deleted = delete_review_rows(db, review_id)
    db.commit()
    return {"deleted": str(review_id), "papers_deleted": papers_deleted}
