"""The signed-in researcher's subscription: read it, and change plan.

Scoped by owner_id = the token's `sub`, with no id in the path, so there is no way to
name anyone else's row. The table has RLS enabled with no policies, which keeps it out
of reach of the public Supabase API entirely; this router is the only way in.

No payment is taken. A change is recorded immediately and the response says what was
recorded. When a payment provider arrives, PUT becomes "start a checkout" and the row is
written by the provider's webhook instead.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.subscription import Subscription
from app.schemas.subscription import SubscriptionChange, SubscriptionOut

router = APIRouter(prefix="/subscription", tags=["subscription"])

PERIOD = {"monthly": timedelta(days=30), "annual": timedelta(days=365)}


def _owner(user: dict) -> uuid.UUID:
    return uuid.UUID(str(user["sub"]))


def _out(row: Subscription | None) -> SubscriptionOut:
    if row is None:
        return SubscriptionOut(plan_id="free", billing="monthly", status="active")
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
    return _out(db.get(Subscription, _owner(user)))


@router.put("", response_model=SubscriptionOut)
def change_subscription(
    change: SubscriptionChange,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> SubscriptionOut:
    """Move to another plan or billing period, starting now."""
    now = datetime.now(timezone.utc)
    # Free has no billing period; storing "annual" there would only mislead the page.
    billing = "monthly" if change.plan_id == "free" else change.billing
    renews_at = None if change.plan_id == "free" else now + PERIOD[billing]

    row = db.get(Subscription, _owner(user))
    if row is None:
        row = Subscription(owner_id=_owner(user), started_at=now)
        db.add(row)
    elif row.plan_id == change.plan_id and row.billing == billing:
        # Choosing the plan you are already on changes nothing, including the dates.
        return _out(row)

    row.plan_id = change.plan_id
    row.billing = billing
    row.status = "active"
    row.started_at = now
    row.renews_at = renews_at
    row.updated_at = now
    db.commit()
    return _out(row)
