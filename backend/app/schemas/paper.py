"""Input contract: one candidate paper, as retrieved from PubMed by Agent 2."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field

# Generous next to any real PubMed record, and far below what would let one request fill
# a prompt or the database. The sanitiser cuts abstracts to max_abstract_chars anyway;
# these refuse the absurd before it is processed at all.
_PublicationType = Annotated[str, Field(max_length=200)]


class Paper(BaseModel):
    pmid: str = Field(max_length=32)
    title: str = Field(default="", max_length=2000)
    abstract: str = Field(default="", max_length=50_000)
    year: int | None = Field(default=None, ge=1800, le=2200)
    journal: str | None = Field(default=None, max_length=500)
    # PubMed's own <PublicationType> values, e.g. ["Randomized Controlled Trial"].
    # This is structured metadata, so the rule layer can trust it in a way it can
    # never trust a claim made in the abstract's prose.
    publication_types: list[_PublicationType] = Field(default_factory=list, max_length=30)
