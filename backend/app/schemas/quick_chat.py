"""The contract for Quick Chat: a document, a thread, and answers from that document."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    # Null on a researcher's own message; on an answer, false means the document did
    # not cover the question, which the UI shows as a limit rather than a finding.
    grounded: bool | None = None
    quotes: list[str] = Field(default_factory=list)
    created_at: datetime


class ChatSessionSummary(BaseModel):
    """One row in the session list down the left."""

    id: uuid.UUID
    title: str
    document_name: str | None = None
    document_pages: int | None = None
    document_chars: int = 0
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class ChatSessionDetail(ChatSessionSummary):
    messages: list[ChatMessageOut] = Field(default_factory=list)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class AskResponse(BaseModel):
    # Both sides of the exchange, already saved, so the client appends rather than
    # guessing what was stored.
    question: ChatMessageOut
    answer: ChatMessageOut
    # True when only extracts of the document were read for this answer. The UI says so,
    # because "not in the document" means something weaker when only part was seen.
    partial_context: bool = False
