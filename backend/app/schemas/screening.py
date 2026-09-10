"""Input contract: Agent 3's draft Include/Exclude call, which Agent 4 re-checks.

Note that Agent 4 compares against this but never shows it to its own LLM - see the
docstring in app/agents/verification/agent.py for why.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, field_validator


class Decision(str, Enum):
    INCLUDE = "INCLUDE"
    EXCLUDE = "EXCLUDE"


class ScreeningDecision(BaseModel):
    pmid: str | None = None
    decision: Decision
    reason: str = ""

    @field_validator("decision", mode="before")
    @classmethod
    def _normalise(cls, value):
        return value.strip().upper() if isinstance(value, str) else value
