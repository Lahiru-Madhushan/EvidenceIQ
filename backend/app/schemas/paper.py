"""Input contract: one candidate paper, as retrieved from PubMed by Agent 2."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Paper(BaseModel):
    pmid: str
    title: str = ""
    abstract: str = ""
    year: int | None = Field(default=None, ge=1800, le=2200)
    journal: str | None = None
    # PubMed's own <PublicationType> values, e.g. ["Randomized Controlled Trial"].
    # This is structured metadata, so the rule layer can trust it in a way it can
    # never trust a claim made in the abstract's prose.
    publication_types: list[str] = Field(default_factory=list)
