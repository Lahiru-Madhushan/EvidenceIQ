"""The signed-in researcher's subscription: read it, and change plan.

Scoped by owner_id = the token's `sub`, with no id in the path, so there is no way to
name anyone else's row. The table has RLS enabled with no policies, which keeps it out
of reach of the public Supabase API entirely; this router is the only way in.

Paid plans are bought, not chosen: the row is moved onto Researcher or Lab only by
app/services/billing.py, once Stripe confirms the payment (see app/routers/payments.py).
PUT here can only move an account to Free. It used to accept any plan, which with
billing connected would have been a free upgrade for anyone who read the API.

A paid period that ends unpaid is reported as Free with status "expired" - computed on
read, so no job has to run at the moment a period ends.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.subscription import Subscription
from app.schemas.subscription import SubscriptionChange, SubscriptionOut

router = APIRouter(prefix="/subscription", tags=["subscription"])

def _owner(user: dict) -> uuid.UUID:
    return uuid.UUID(str(user["sub"]))


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def subscription_out(row: Subscription | None) -> SubscriptionOut:
    if row is None:
        return SubscriptionOut(plan_id="free", billing="monthly", status="active")
    renews_at = _aware(row.renews_at)
    if row.plan_id != "free" and renews_at is not None and renews_at <= datetime.now(timezone.utc):
        # The paid period ran out. Back on Free until the next payment; which plan
        # lapsed is kept so the page can offer to renew it.
        return SubscriptionOut(
            plan_id="free",
            billing="monthly",
            status="expired",
            started_at=row.started_at,
            renews_at=None,
            expired_plan_id=row.plan_id,
            expired_at=renews_at,
        )
    return SubscriptionOut(
        plan_id=row.plan_id,
        billing=row.billing,
        status=row.status,
        started_at=row.started_at,
        renews_at=row.renews_at,
    )


@router.get("", response_model=SubscriptionOut)
def get_subscription(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SubscriptionOut:
    """The current plan. An account that never chose one is on Free."""
    return subscription_out(db.get(Subscription, _owner(user)))


@router.put("", response_model=SubscriptionOut)
def change_subscription(
    change: SubscriptionChange,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SubscriptionOut:
    """Move to Free, starting now. Paid plans go through POST /api/payments/checkout."""
    if change.plan_id != "free":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Paid plans are bought through checkout: POST /api/payments/checkout.",
        )
    now = datetime.now(timezone.utc)

    row = db.get(Subscription, _owner(user))
    if row is None:
        # No row already means Free.
        return subscription_out(None)
    if row.plan_id == "free":
        # Choosing the plan you are already on changes nothing, including the dates.
        return subscription_out(row)

    # Free has no billing period; storing "annual" there would only mislead the page.
    row.plan_id = "free"
    row.billing = "monthly"
    row.status = "active"
    row.started_at = now
    row.renews_at = None
    row.updated_at = now
    db.commit()
    return subscription_out(row)
