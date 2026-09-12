import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.review import Review
from app.schemas.review import (
    CriteriaSubmitRequest,
    ClarificationAnswerRequest,
    ClarificationNeededResponse,
    ProtocolReadyResponse,
    ReviewResponse,
    ReviewUpdateRequest,
)
from app.services.criteria_agent import interpret_criteria

router = APIRouter(prefix="/criteria", tags=["criteria-agent"])


@router.post("/submit")
def submit_criteria(
    payload: CriteriaSubmitRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    First step: researcher submits a research question + raw criteria.
    Creates a new review row and runs it through the Criteria Agent.
    """
    result = interpret_criteria(
        research_question=payload.research_question,
        raw_criteria=payload.raw_criteria,
    )

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
def submit_clarification(payload: ClarificationAnswerRequest, db: Session = Depends(get_db)):
    """
    Second step (only if needed): researcher answers a clarification question.
    Re-runs interpretation with the answer included, and finalizes the protocol.
    """
    review = db.get(Review, payload.review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")

    clarification_context = f"Researcher's clarification: {payload.answer}"
    result = interpret_criteria(
        research_question=review.research_question,
        raw_criteria=review.raw_criteria or "",
        clarification_context=clarification_context,
    )

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
def get_review(review_id: uuid.UUID, db: Session = Depends(get_db)):
    """Fetch a single review by ID."""
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.get("/", response_model=list[ReviewResponse])
def list_reviews(db: Session = Depends(get_db)):
    """List all reviews. (Filtering by logged-in user comes later with auth.)"""
    return db.query(Review).order_by(Review.created_at.desc()).all()


@router.put("/{review_id}", response_model=ReviewResponse)
def update_review(review_id: uuid.UUID, payload: ReviewUpdateRequest, db: Session = Depends(get_db)):
    """Update a review's research question. Resets status/protocol since criteria changed."""
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")

    review.research_question = payload.research_question
    review.status = "draft"
    review.protocol = None
    db.commit()
    db.refresh(review)
    return review