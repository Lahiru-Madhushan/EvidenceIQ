"""The contract for a researcher's subscription: which plan, billed how, until when.

Only plan ids live here. Prices, limits and features are in the frontend's lib/plans.js,
the single catalogue both the landing page and the account pages read; the backend only
needs to know which ids are real so it never stores one that is not.
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


class SubscriptionChange(BaseModel):
    plan_id: PlanId
    billing: Billing = "monthly"
