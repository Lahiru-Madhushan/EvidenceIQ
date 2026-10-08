"""The contract for a researcher's subscription: which plan, billed how, until when.

Only plan ids live here. Limits and features are in the frontend's lib/plans.js; prices
are there for display and in app/services/billing.py for charging, and a test keeps the
two equal.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

PlanId = Literal["free", "researcher", "lab"]
Billing = Literal["monthly", "annual"]


class SubscriptionOut(BaseModel):
    plan_id: PlanId
    billing: Billing
    status: str
    # Null for an account that has never chosen a plan and is on Free by default.
    started_at: datetime | None = None
    renews_at: datetime | None = None
    # Set when status is "expired": the paid plan whose period ran out, and when.
    expired_plan_id: PlanId | None = None
    expired_at: datetime | None = None


class SubscriptionChange(BaseModel):
    plan_id: PlanId
    billing: Billing = "monthly"
