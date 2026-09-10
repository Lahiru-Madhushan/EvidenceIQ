"""SQLAlchemy model for the 'papers' table.

One row per candidate paper. Each agent stage adds columns to the SAME row - a
paper is never copied between tables. See the team's Database Guide, section 4,
for the full column reference and "who writes what" (section 11).
"""

import uuid
from datetime import datetime

from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, Boolean, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Paper(Base):
    __tablename__ = "papers"

    # Identity
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    review_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reviews.id"))

    # AGENT 2 (Retrieval) writes these - we (Agent 3) only READ them
    pmid: Mapped[str] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=True)
    abstract: Mapped[str] = mapped_column(Text, nullable=True)
    journal: Mapped[str] = mapped_column(String, nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=True)
    publication_types: Mapped[list] = mapped_column(ARRAY(String), nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    # AGENT 3 (Screening) - THIS IS OUR JOB, we WRITE these
    draft_decision: Mapped[str] = mapped_column(String, nullable=True)
    draft_reason: Mapped[str] = mapped_column(Text, nullable=True)
    screened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    # AGENT 4 (Verification) writes these - we only READ draft fields, never these
    verified_decision: Mapped[str] = mapped_column(String, nullable=True)
    confidence: Mapped[str] = mapped_column(String, nullable=True)
    agreement: Mapped[bool] = mapped_column(Boolean, nullable=True)
    needs_human_review: Mapped[bool] = mapped_column(Boolean, nullable=True)
    verification_note: Mapped[str] = mapped_column(Text, nullable=True)
    checks: Mapped[list] = mapped_column(JSONB, nullable=True)
    issues: Mapped[list] = mapped_column(JSONB, nullable=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    # RESEARCHER writes these - we never touch these
    researcher_status: Mapped[str] = mapped_column(String, nullable=True)
    researcher_note: Mapped[str] = mapped_column(Text, nullable=True)
    researcher_decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)