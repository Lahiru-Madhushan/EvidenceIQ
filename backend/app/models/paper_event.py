"""SQLAlchemy model for the 'paper_events' table - the audit trail.

The columns in `papers` only hold the CURRENT state. When Agent 4 re-runs, or a
researcher changes their mind, the previous value is overwritten and gone. This table
keeps the trail, which is what makes "log every screening decision, who approved or
overrode what and when" demonstrable rather than merely claimed.

Append-only by policy: the RLS rules allow SELECT and INSERT but no UPDATE or DELETE.
An audit log that people can edit is not an audit log. Nothing in this codebase should
ever update or delete a row here - see the team's Database Guide, section 5.
"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Identity, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# The values the database's CHECK constraint allows. Written out rather than imported
# from anywhere, because the constraint is the real authority and this must match it.
ACTOR_AGENT_3 = "agent_3"
ACTOR_AGENT_4 = "agent_4"
ACTOR_RESEARCHER = "researcher"

# The vocabulary the Database Guide defines for `action`.
ACTION_SCREENED = "screened"
ACTION_VERIFIED = "verified"
ACTION_APPROVED = "approved"
ACTION_OVERRIDDEN = "overridden"


class PaperEvent(Base):
    __tablename__ = "paper_events"

    # GENERATED ALWAYS AS IDENTITY in Postgres: never supply a value, the database
    # refuses it. Identity(always=True) tells SQLAlchemy to leave it out of INSERTs.
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    paper_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )

    # One of ACTOR_* above; the database enforces the list.
    actor: Mapped[str] = mapped_column(String, nullable=False)
    # One of ACTION_* above.
    action: Mapped[str] = mapped_column(Text, nullable=False)
    # Whatever is worth recording for this event - the decision, confidence, a note.
    detail: Mapped[dict] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
