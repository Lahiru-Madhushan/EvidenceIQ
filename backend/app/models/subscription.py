"""SQLAlchemy model for the 'subscriptions' table.

One row per account that has ever chosen a plan. An account with no row is on Free, so
nobody needs a row written at sign-up. There is no payment provider yet: a change here
is recorded as made, and this table is where a checkout would confirm it once one exists.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)

    # One of app.schemas.subscription.PlanId; the table's CHECK constraint agrees.
    plan_id: Mapped[str] = mapped_column(String, nullable=False, default="free")
    # "monthly" or "annual". Always "monthly" on Free, where the period means nothing.
    billing: Mapped[str] = mapped_column(String, nullable=False, default="monthly")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")

    # When the current plan began, not when the row was first written, so "member since"
    # and "on this plan since" stay different questions.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # End of the current billing period. Null on Free, which never renews.
    renews_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
