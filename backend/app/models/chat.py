"""SQLAlchemy models for Quick Chat.

One session per uploaded document, with its thread of messages. Kept apart from
reviews/papers: those hold the screening pipeline's own record, assembled by the agents
and read back as evidence, while a chat session is the researcher's scratch work over a
document they brought themselves.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    title: Mapped[str] = mapped_column(String, nullable=False, default="New chat")

    document_name: Mapped[str] = mapped_column(String, nullable=True)
    # The extracted text, stored whole. An answer has to remain traceable to the exact
    # text that produced it, so this is kept rather than re-derived from a file that may
    # no longer exist.
    document_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    document_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document_pages: Mapped[int] = mapped_column(Integer, nullable=True)
    # The file as uploaded, so the researcher can read the original next to the chat.
    # Deferred: it is the heaviest column by far and only the document endpoint needs it.
    # Null on chats created before the file was kept; those fall back to the text above.
    document_file: Mapped[bytes] = mapped_column(LargeBinary, nullable=True, deferred=True)
    document_mime: Mapped[str] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False
    )

    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Stored rather than recomputed: reopening a thread must show the same "not in this
    # document" marks it showed when the answer was first given.
    grounded: Mapped[bool] = mapped_column(Boolean, nullable=True)
    quotes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    session: Mapped[ChatSession] = relationship(back_populates="messages")
