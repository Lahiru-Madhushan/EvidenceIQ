"""The contract for asking questions about one paper."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    """One earlier message in the thread, replayed so follow-ups make sense."""

    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class PaperChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


class PaperSummary(BaseModel):
    """What the chat shows above the thread, so the reader knows what they are asking about."""

    pmid: str | None = None
    title: str | None = None
    journal: str | None = None
    year: int | None = None
    publication_types: list[str] = Field(default_factory=list)
    # The opening of the paper's own abstract, not a generated summary.
    gist: str = ""
    has_abstract: bool = False
    verified_decision: str | None = None
    draft_decision: str | None = None
    confidence: str | None = None


class PaperChatResponse(BaseModel):
    answer: str
    # False when the paper does not cover the question. The UI shows these differently:
    # "this paper does not say" is a useful answer, but it is not a finding.
    grounded: bool
    # Verbatim spans from the paper, each checked against the context before being
    # returned. A quote the paper does not contain is dropped rather than shown.
    quotes: list[str] = Field(default_factory=list)
