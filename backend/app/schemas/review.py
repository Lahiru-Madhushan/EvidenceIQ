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
    """What the researcher sends to update their research question."""
    research_question: str