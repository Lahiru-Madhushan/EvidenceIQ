"""Agent 4's own contract: what the Verification Agent is asked, and what it answers."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator

from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision


class CheckStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    # The paper text does not say. Deliberately distinct from FAIL: a missing fact is
    # not a disqualifying fact, and must not silently drop a paper.
    UNCLEAR = "UNCLEAR"


class Confidence(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"
    DISAGREEMENT = "DISAGREEMENT"


class CheckSource(str, Enum):
    # Decided from structured metadata by a deterministic rule, with no LLM involved.
    RULE = "rule"
    # Decided from the paper's prose by the LLM.
    LLM = "llm"


class CriterionCheck(BaseModel):
    criterion: str
    status: CheckStatus
    # A span quoted from the paper text (or the metadata) that justifies the status.
    evidence: str = ""
    source: CheckSource = CheckSource.LLM

    @field_validator("status", mode="before")
    @classmethod
    def _normalise(cls, value):
        return value.strip().upper() if isinstance(value, str) else value


class VerifyRequest(BaseModel):
    paper: Paper
    protocol: Protocol
    screening_decision: ScreeningDecision


class VerificationResult(BaseModel):
    pmid: str
    # Agent 4's own call, reached without ever seeing screening_decision.
    verified_decision: Decision
    # What Agent 3 said, echoed back for the researcher's review screen.
    screening_decision: Decision
    agreement: bool
    verification_status: VerificationStatus
    confidence: Confidence
    checks: list[CriterionCheck] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    verification_note: str = ""
    # The researcher approves every paper regardless; this only sorts their queue.
    needs_human_review: bool = False


class BatchVerifyItemRequest(BaseModel):
    paper: Paper
    screening_decision: ScreeningDecision


class BatchVerifyRequest(BaseModel):
    """One protocol, many papers - the shape a whole screened search takes."""

    protocol: Protocol
    items: list[BatchVerifyItemRequest] = Field(default_factory=list)


class BatchVerifyItem(BaseModel):
    pmid: str
    result: VerificationResult | None = None
    error: str | None = None


class BatchVerifyResponse(BaseModel):
    total: int
    verified: int
    disagreements: int
    needs_human_review: int
    failed: int
    results: list[BatchVerifyItem] = Field(default_factory=list)
