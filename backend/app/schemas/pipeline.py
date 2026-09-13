"""The contract for running Agent 3 and Agent 4 as one pass.

Screening and verification were built as separate endpoints on purpose - Agent 4 is a
genuinely independent second opinion, not a post-processing step Agent 3 controls. This
module does not weaken that: it only saves the caller from having to hand-carry Agent 3's
output into Agent 4 and then write both sets of columns itself.

The two results stay separate fields in the response rather than being merged into one
flattened decision, because the whole point of the pair is that they can disagree.
"""

from __future__ import annotations

import uuid
from enum import Enum

from pydantic import BaseModel, Field

from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import ScreeningDecision
from app.schemas.verification import VerificationResult


class PipelineStatus(str, Enum):
    # Both agents ran and their results were recorded.
    COMPLETE = "COMPLETE"
    # Agent 3 produced a draft, but Agent 4 could not be reached. The draft is still
    # saved - losing a good screening decision because the second opinion timed out
    # would be worse than reporting a partial result.
    VERIFICATION_FAILED = "VERIFICATION_FAILED"


class PipelineRunRequest(BaseModel):
    """Stateless run: screen and verify one paper without touching the database."""

    paper: Paper
    protocol: Protocol


class PipelineResult(BaseModel):
    pmid: str
    # Present only when the run came from a stored row, so the caller can write back.
    paper_id: uuid.UUID | None = None
    status: PipelineStatus
    screening: ScreeningDecision
    # Null exactly when status is VERIFICATION_FAILED.
    verification: VerificationResult | None = None
    verification_error: str | None = None

    @property
    def disagreed(self) -> bool:
        return self.verification is not None and not self.verification.agreement


class PipelineItem(BaseModel):
    pmid: str
    paper_id: uuid.UUID | None = None
    result: PipelineResult | None = None
    # Set when screening itself failed, so there is no result at all.
    error: str | None = None


class FullRunRequest(BaseModel):
    """What the whole chain needs to start: a question and the criteria in prose."""

    research_question: str = Field(min_length=3, max_length=1000)
    raw_criteria: str = Field(min_length=3, max_length=5000)
    # Agent 2's PubMed query. Defaults to the research question, which is usually a
    # workable search on its own.
    query: str | None = Field(default=None, max_length=500)
    max_results: int = Field(default=10, ge=1, le=50)


class PipelineBatchResponse(BaseModel):
    """Counts first, then the per-paper detail - the shape a review dashboard needs."""

    total: int
    # Papers that got all the way through both agents.
    complete: int
    # Screened, but Agent 4 could not be reached.
    verification_failed: int
    # Screening itself failed; nothing was recorded for these.
    failed: int
    included: int
    excluded: int
    # Papers where Agent 4 reached a different conclusion than Agent 3.
    disagreements: int
    needs_human_review: int
    skipped: int = 0
    results: list[PipelineItem] = Field(default_factory=list)


class FullRunResponse(BaseModel):
    """The result of one Agent 1 -> 2 -> 3 -> 4 run.

    `stopped_at` names the agent that ended the chain early, and is null when all four
    ran. A chain can stop legitimately - Agent 1 asking for clarification is the system
    working correctly, not an error - so this is a 200 with a reason, not a failure.
    """

    review_id: uuid.UUID | None = None
    protocol: Protocol | None = None
    stopped_at: str | None = None

    # Set when Agent 1 needed the researcher to disambiguate something.
    clarification_needed: bool = False
    ambiguous_term: str | None = None
    question: str | None = None

    # Agent 2's tallies.
    total_found: int = 0
    saved_count: int = 0

    # Agents 3 and 4, once there are papers to work on.
    screening: "PipelineBatchResponse | None" = None
    message: str | None = None
