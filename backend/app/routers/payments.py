"""Paying for a plan with Stripe Checkout, and the record of every payment.

Flow:
  1. POST /payments/checkout       records a pending payment, returns Stripe's page URL.
  2. The researcher pays on Stripe's page (the card never touches this server).
  3. Stripe redirects back with ?session_id=..., and the page calls POST /payments/confirm,
     which reads that session from Stripe and, if it is paid, grants the plan.
  4. Stripe also calls POST /payments/webhook. Either 3 or 4 alone is enough, and both
     together are harmless: applying a session is idempotent. The webhook is what
     records a payment whose researcher closed the tab before the redirect.

Everything but the webhook is scoped to the caller's token. The webhook carries no
token - Stripe is the caller - so it is authenticated by its signature instead.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.payment import Payment
from app.models.subscription import Subscription
from app.routers.subscription import subscription_out
from app.schemas.payment import CheckoutOut, CheckoutRequest, ConfirmOut, ConfirmRequest, PaymentOut
from app.services import billing, stripe_client

logger = logging.getLogger(__name__)
security_log = logging.getLogger("evidenceiq.security")

router = APIRouter(prefix="/payments", tags=["payments"])

# Events that can change a payment. Anything else Stripe sends is acknowledged and
# ignored, so enabling more events in the dashboard never makes deliveries fail.
_HANDLED = {
    "checkout.session.completed": False,
    "checkout.session.async_payment_succeeded": False,
    "checkout.session.async_payment_failed": True,
    "checkout.session.expired": False,
}


def _owner(user: dict) -> uuid.UUID:
    return uuid.UUID(str(user["sub"]))


def _unavailable(exc: stripe_client.StripeError) -> HTTPException:
    if isinstance(exc, stripe_client.StripeNotConfigured):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments are not set up on this server yet, so paid plans cannot be bought.",
        )
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/checkout", response_model=CheckoutOut, status_code=201)
async def start_checkout(
    request: CheckoutRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> CheckoutOut:
    """Start paying for a plan. The price is set here, never taken from the request."""
    try:
        payment, url = await billing.start_checkout(
            db,
            owner_id=_owner(user),
            email=user.get("email"),
            plan_id=request.plan_id,
            billing=request.billing,
        )
    except billing.BillingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except stripe_client.StripeError as exc:
        raise _unavailable(exc) from exc
    return CheckoutOut(payment_id=payment.id, checkout_url=url)


@router.post("/confirm", response_model=ConfirmOut)
async def confirm_checkout(
    request: ConfirmRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ConfirmOut:
    """Called by the page Stripe redirects back to. Asks Stripe what really happened."""
    owner = _owner(user)
    try:
        payment = await billing.sync_session(db, request.session_id, owner_id=owner)
    except billing.BillingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except stripe_client.StripeError as exc:
        raise _unavailable(exc) from exc
    if payment is None or payment.owner_id != owner:
        raise HTTPException(status_code=404, detail="No such checkout.")
    return ConfirmOut(
        payment=PaymentOut.model_validate(payment),
        subscription=subscription_out(db.get(Subscription, owner)),
    )


@router.post("/{payment_id}/cancel", response_model=PaymentOut)
async def cancel_checkout(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> PaymentOut:
    """The researcher left Stripe's page without paying."""
    try:
        payment = await billing.cancel_checkout(db, owner_id=_owner(user), payment_id=payment_id)
    except billing.BillingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except stripe_client.StripeError as exc:
        raise _unavailable(exc) from exc
    return PaymentOut.model_validate(payment)


@router.get("", response_model=list[PaymentOut])
def list_payments(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[PaymentOut]:
    """The caller's payment history, newest first."""
    rows = db.execute(
        select(Payment)
        .where(Payment.owner_id == _owner(user))
        .order_by(Payment.created_at.desc())
        .limit(100)
    ).scalars()
    return [PaymentOut.model_validate(row) for row in rows]


@router.post("/webhook", include_in_schema=True)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    """Stripe's notification that a checkout changed. Authenticated by signature.

    The event body is used only for its type and session id. What is recorded comes
    from reading the session back from Stripe's API, so even a correctly signed event
    could not, by its content alone, grant a plan Stripe does not show as paid.
    """
    payload = await request.body()
    try:
        event = stripe_client.verify_webhook(
            payload, request.headers.get("stripe-signature"), settings.stripe_webhook_secret
        )
    except stripe_client.InvalidSignature as exc:
        security_log.warning("stripe_webhook_rejected reason=%s", exc)
        raise HTTPException(status_code=400, detail="Invalid signature.") from exc

    event_type = event.get("type")
    if event_type not in _HANDLED:
        return {"received": True, "handled": False}

    session_id = ((event.get("data") or {}).get("object") or {}).get("id", "")
    try:
        await billing.sync_session(db, session_id, failed=_HANDLED[event_type])
    except stripe_client.StripeError as exc:
        # A 5xx makes Stripe retry the delivery later, which is what we want here.
        logger.error("Webhook %s for %s not applied: %s", event_type, session_id, exc)
        raise HTTPException(status_code=503, detail="Try again later.") from exc
    return {"received": True, "handled": True}
