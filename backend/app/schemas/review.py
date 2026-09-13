import uuid
from typing import Optional
from pydantic import BaseModel


class CriteriaSubmitRequest(BaseModel):
    """What the researcher sends when starting a new review."""
    research_question: str
    raw_criteria: str


class ClarificationAnswerRequest(BaseModel):
    """What the researcher sends when answering a clarification question."""
    review_id: uuid.UUID
    answer: str


class ClarificationNeededResponse(BaseModel):
    """Returned when the LLM found something ambiguous."""
    status: str = "clarification_needed"
    review_id: uuid.UUID
    ambiguous_term: str
    question: str


class ProtocolReadyResponse(BaseModel):
    """Returned once the protocol is finalized."""
    status: str = "ready"
    review_id: uuid.UUID
    protocol: dict


class ReviewResponse(BaseModel):
    """Full representation of a review, used for GET endpoints."""
    id: uuid.UUID
    research_question: str
    raw_criteria: Optional[str] = None
    protocol: Optional[dict] = None
    status: str

    class Config:
        from_attributes = True


class ReviewUpdateRequest(BaseModel):
    """What the researcher sends to change a review's question or criteria.

    Both are optional so the form can send only what changed; whichever is omitted
    keeps its stored value, and Agent 1 re-interprets the pair either way.
    """
    research_question: Optional[str] = None
    raw_criteria: Optional[str] = None


class ReviewUpdatedResponse(BaseModel):
    """The result of an edit, which is the result of re-running Agent 1.

    Same two outcomes as /submit - a protocol, or a question - because editing the
    criteria puts the review back through exactly the same interpretation.
    """
    status: str  # "ready" | "clarification_needed"
    review_id: uuid.UUID
    protocol: Optional[dict] = None
    ambiguous_term: Optional[str] = None
    question: Optional[str] = None

    # Papers screened against the PREVIOUS protocol. Their decisions are now stale, but
    # they are Agents 3 and 4's columns to rewrite, not Agent 1's - so they are counted
    # and reported rather than silently cleared, and the researcher re-runs screening.
    stale_screened_count: int = 0

class ReviewStatusResponse(BaseModel):
    """The result of recomputing a review's status from its papers."""
    review_id: uuid.UUID
    status: str
    # False when the status was already correct - lets a caller skip a refetch.
    changed: bool
    total_papers: int
    screened_papers: int
    decided_papers: int
