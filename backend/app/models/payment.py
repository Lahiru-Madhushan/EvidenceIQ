"""SQLAlchemy model for the 'payments' table.

One row per checkout started. The row is written as 'pending' before the researcher is
sent to Stripe, so an abandoned or failed checkout is still on record, and it is moved
to 'paid' only after the backend has read the outcome from Stripe itself - never on the
browser's word. See migrations/20261008_payments.sql.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)

    plan_id: Mapped[str] = mapped_column(String, nullable=False)
    billing: Mapped[str] = mapped_column(String, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String, nullable=False, default="usd")
    # pending -> paid | failed | cancelled | expired
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(String, nullable=False, default="stripe")

    stripe_checkout_session_id: Mapped[str | None] = mapped_column(String, unique=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String)
    # What a receipt shows, never the card itself.
    card_brand: Mapped[str | None] = mapped_column(String)
    card_last4: Mapped[str | None] = mapped_column(String)
    receipt_url: Mapped[str | None] = mapped_column(String)

    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(String)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
