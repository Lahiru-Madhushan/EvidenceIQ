"""SQLAlchemy model for the 'reviews' table.

One row per research question a user has set up. See the team's Database Guide,
section 3, for the full column reference - this mirrors it exactly.
"""

import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Review(Base):
    __tablename__ = "reviews"

    # Identity
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))

    # HUMAN - set when the researcher creates the review
    research_question: Mapped[str] = mapped_column(Text)

    # HUMAN - the original plain-language criteria, kept so /clarify can reference it
    raw_criteria: Mapped[str] = mapped_column(Text, nullable=True)

    # AGENT 1 (Criteria) writes this - the structured rules Agents 3 and 4 both read
    protocol: Mapped[dict] = mapped_column(JSONB, nullable=True)

    # One of: draft, awaiting_clarification, screening, complete
    status: Mapped[str] = mapped_column(String, default="draft")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())