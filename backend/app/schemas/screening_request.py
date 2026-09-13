"""Agent 3's own request/response contract - what the Screening Agent is asked
and what it answers, separate from schemas/screening.py (the ScreeningDecision
shape that Agent 4 consumes downstream).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import ScreeningDecision


class ScreenRequest(BaseModel):
    paper: Paper
    protocol: Protocol


class BatchScreenRequest(BaseModel):
    """One protocol, many papers - the shape a whole retrieved search takes."""

    protocol: Protocol
    papers: list[Paper] = Field(default_factory=list)


class BatchScreenItem(BaseModel):
    pmid: str
    result: ScreeningDecision | None = None
    error: str | None = None


class BatchScreenResponse(BaseModel):
    total: int
    included: int
    excluded: int
    failed: int
    results: list[BatchScreenItem] = Field(default_factory=list)