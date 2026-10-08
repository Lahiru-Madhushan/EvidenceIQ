"""Input contract: Agent 3's draft Include/Exclude call, which Agent 4 re-checks.

Note that Agent 4 compares against this but never shows it to its own LLM - see the
docstring in app/agents/verification/agent.py for why.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Decision(str, Enum):
    INCLUDE = "INCLUDE"
    EXCLUDE = "EXCLUDE"


class ScreeningDecision(BaseModel):
    pmid: str | None = None
    decision: Decision
    reason: str = ""
    # What the sanitiser found in the paper's text (injection wording, hidden characters,
    # truncation). These used to be computed and then thrown away, so a paper that tried
    # to manipulate the model reached the reviewer with no warning attached.
    flags: list[str] = Field(default_factory=list)
    # True when the draft rests on too little to trust without a person looking: a flag
    # was raised, or there was no abstract to judge. Agent 4 still re-checks either way.
    needs_human_review: bool = False
    # Which model produced the draft, so the decision can be traced to its source.
    model: str | None = None

    @field_validator("decision", mode="before")
    @classmethod
    def _normalise(cls, value):
        return value.strip().upper() if isinstance(value, str) else value
