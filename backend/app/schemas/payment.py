"""The contract for paying for a plan, and for the record of what was paid."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.subscription import Billing, SubscriptionOut

# Free is not sold, so it cannot be checked out; moving to it is PUT /api/subscription.
PaidPlanId = Literal["researcher", "lab"]


class CheckoutRequest(BaseModel):
    plan_id: PaidPlanId
    billing: Billing = "monthly"


class CheckoutOut(BaseModel):
    payment_id: uuid.UUID
    # Stripe's hosted payment page. The browser goes there; the card never comes here.
    checkout_url: str


class ConfirmRequest(BaseModel):
    session_id: str = Field(pattern=r"^cs_(test|live)_[A-Za-z0-9]{10,200}$")


class PaymentOut(BaseModel):
    id: uuid.UUID
    plan_id: str
    billing: str
    amount_cents: int
    currency: str
    status: str
    card_brand: str | None = None
    card_last4: str | None = None
    receipt_url: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    failure_reason: str | None = None
    created_at: datetime
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}


class ConfirmOut(BaseModel):
    payment: PaymentOut
    subscription: SubscriptionOut
