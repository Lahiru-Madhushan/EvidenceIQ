"""Paid plans: what they cost, starting a checkout, and recording what Stripe says.

The model is prepaid, not auto-renewing. Each payment buys one period - 30 days on
monthly billing, 365 on annual - and paying again for the plan you are on extends it
from where it ends rather than from today, so renewing early never loses time. When a
period runs out unpaid, the account is back on Free (see subscription._out). Recurring
Stripe Subscriptions would need renewal, dunning and cancellation flows of their own;
one explicit payment per period keeps every charge a deliberate act with its own record.

The plan only ever changes in apply_session, and only from a checkout session read
from Stripe's API by this server. A browser saying "I paid" proves nothing; the redirect
back from Stripe carries only a session id, which is used to ask Stripe.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.payment import Payment
from app.models.subscription import Subscription
from app.services import stripe_client

logger = logging.getLogger(__name__)
security_log = logging.getLogger("evidenceiq.security")

CURRENCY = "usd"

# Whole dollars, per month - the figures frontend/src/lib/plans.js shows. Annual is the
# discounted monthly rate, charged twelve times up front. tests/test_payments.py fails
# if the two catalogues ever disagree, because the price a researcher is charged must
# be the price they were shown.
PRICES_USD: dict[str, dict[str, int]] = {
    "researcher": {"monthly": 29, "annual": 24},
    "lab": {"monthly": 99, "annual": 82},
}
PLAN_NAMES = {"researcher": "Researcher", "lab": "Lab"}
PERIOD = {"monthly": timedelta(days=30), "annual": timedelta(days=365)}


class BillingError(Exception):
    """A request billing refuses, with a message fit to show the researcher."""


def amount_cents(plan_id: str, billing: str) -> int:
    monthly_rate = PRICES_USD[plan_id][billing]
    months = 12 if billing == "annual" else 1
    return monthly_rate * months * 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """Timestamps read back without a zone (SQLite in tests) are UTC, as written."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def start_checkout(
    db: Session, *, owner_id: uuid.UUID, email: str | None, plan_id: str, billing: str
) -> tuple[Payment, str]:
    """Record a pending payment and open a Stripe Checkout for it. Returns its URL."""
    if plan_id not in PRICES_USD:
        raise BillingError("That plan is not sold.")
    if not stripe_client.configured():
        raise stripe_client.StripeNotConfigured("Payments are not configured on this server.")

    now = _now()
    payment = Payment(
        id=uuid.uuid4(),
        owner_id=owner_id,
        plan_id=plan_id,
        billing=billing,
        amount_cents=amount_cents(plan_id, billing),
        currency=CURRENCY,
        status="pending",
        provider="stripe",
        created_at=now,
        updated_at=now,
    )
    db.add(payment)
    db.commit()

    days = PERIOD[billing].days
    app_url = settings.public_app_url.rstrip("/")
    params: dict[str, Any] = {
        "mode": "payment",
        "line_items": [
            {
                "quantity": 1,
                "price_data": {
                    "currency": CURRENCY,
                    "unit_amount": payment.amount_cents,
                    "product_data": {
                        "name": f"EvidenceIQ {PLAN_NAMES[plan_id]} plan ({billing})",
                        "description": f"{days} days of the {PLAN_NAMES[plan_id]} plan.",
                    },
                },
            }
        ],
        # Stripe fills in {CHECKOUT_SESSION_ID}; the page sends it back to /confirm.
        "success_url": f"{app_url}/subscription?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{app_url}/subscription?checkout=cancelled&payment_id={payment.id}",
        "client_reference_id": str(payment.id),
        "metadata": {
            "payment_id": str(payment.id),
            "owner_id": str(owner_id),
            "plan_id": plan_id,
            "billing": billing,
        },
        "payment_intent_data": {"metadata": {"payment_id": str(payment.id)}},
    }
    if email:
        params["customer_email"] = email

    try:
        session = await stripe_client.create_checkout_session(
            params, idempotency_key=f"checkout-{payment.id}"
        )
    except stripe_client.StripeError as exc:
        payment.status = "failed"
        payment.failure_reason = str(exc)[:500]
        payment.updated_at = _now()
        db.commit()
        raise

    payment.stripe_checkout_session_id = session["id"]
    payment.updated_at = _now()
    db.commit()
    return payment, session["url"]


def _payment_for_session(db: Session, session: dict[str, Any]) -> Payment | None:
    """The payment a session belongs to, locked against a concurrent update.

    The webhook and the success page usually arrive within a second of each other, and
    both apply the same session. The row lock makes the second one wait and then find
    the payment already paid, instead of extending the plan twice.
    """
    query = select(Payment).where(Payment.stripe_checkout_session_id == session.get("id"))
    return db.execute(query.with_for_update()).scalar_one_or_none()


def apply_session(db: Session, session: dict[str, Any], *, failed: bool = False) -> Payment | None:
    """Bring our records in line with a checkout session read from Stripe.

    Idempotent: a payment already marked paid is returned unchanged, so a webhook
    retried by Stripe, or a success page reloaded, can never extend a plan twice.
    """
    payment = _payment_for_session(db, session)
    if payment is None:
        logger.warning("Checkout session with no matching payment: %s", session.get("id"))
        return None
    if payment.status == "paid":
        db.rollback()
        return payment

    metadata = session.get("metadata") or {}
    if metadata.get("payment_id") != str(payment.id):
        security_log.warning("checkout_mismatch payment=%s reason=metadata", payment.id)
        db.rollback()
        return payment

    now = _now()
    payment.updated_at = now

    if session.get("payment_status") == "paid":
        charged, currency = session.get("amount_total"), (session.get("currency") or "").lower()
        if charged != payment.amount_cents or currency != payment.currency:
            # Stripe charged something other than what this server priced. Never grant
            # a plan on it; record why, so the discrepancy can be looked into.
            security_log.warning(
                "checkout_mismatch payment=%s reason=amount charged=%s %s",
                payment.id, charged, currency,
            )
            payment.status = "failed"
            payment.failure_reason = "The amount charged did not match the plan price."
            db.commit()
            return payment

        intent = session.get("payment_intent")
        charge = intent.get("latest_charge") if isinstance(intent, dict) else None
        card = ((charge or {}).get("payment_method_details") or {}).get("card") or {}

        subscription = db.get(Subscription, payment.owner_id)
        renews_at = _aware(subscription.renews_at) if subscription else None
        same_plan = (
            subscription is not None
            and subscription.plan_id == payment.plan_id
            and subscription.billing == payment.billing
        )
        # Renewing early stacks onto the time already paid for.
        start = renews_at if same_plan and renews_at and renews_at > now else now
        end = start + PERIOD[payment.billing]

        if subscription is None:
            subscription = Subscription(owner_id=payment.owner_id, started_at=now)
            db.add(subscription)
        elif not same_plan or subscription.status != "active" or not renews_at or renews_at <= now:
            subscription.started_at = now
        subscription.plan_id = payment.plan_id
        subscription.billing = payment.billing
        subscription.status = "active"
        subscription.renews_at = end
        subscription.updated_at = now

        payment.status = "paid"
        payment.paid_at = now
        payment.period_start = start
        payment.period_end = end
        payment.failure_reason = None
        payment.stripe_payment_intent_id = (
            intent.get("id") if isinstance(intent, dict) else intent
        )
        payment.card_brand = card.get("brand")
        payment.card_last4 = card.get("last4")
        payment.receipt_url = (charge or {}).get("receipt_url")
        db.commit()
        logger.info("Payment %s paid: %s/%s", payment.id, payment.plan_id, payment.billing)
        return payment

    if failed:
        payment.status = "failed"
        payment.failure_reason = "The payment did not go through."
    elif session.get("status") == "expired" and payment.status == "pending":
        payment.status = "expired"
    db.commit()
    return payment


async def sync_session(
    db: Session, session_id: str, *, owner_id: uuid.UUID | None = None, failed: bool = False
) -> Payment | None:
    """Read a session from Stripe and apply it. `owner_id` restricts it to one account."""
    session = await stripe_client.retrieve_checkout_session(session_id)
    if owner_id is not None and (session.get("metadata") or {}).get("owner_id") != str(owner_id):
        # Someone else's session id. Answer as if it does not exist.
        raise BillingError("No such checkout.")
    return apply_session(db, session, failed=failed)


async def cancel_checkout(db: Session, *, owner_id: uuid.UUID, payment_id: uuid.UUID) -> Payment:
    """The researcher came back without paying: close the checkout and record it."""
    payment = db.get(Payment, payment_id)
    if payment is None or payment.owner_id != owner_id:
        raise BillingError("No such checkout.")
    if payment.status != "pending":
        return payment

    if payment.stripe_checkout_session_id:
        try:
            session = await stripe_client.expire_checkout_session(payment.stripe_checkout_session_id)
        except stripe_client.StripeError:
            # Already completed or expired on Stripe's side - read what really happened
            # rather than overwrite it with "cancelled".
            await sync_session(db, payment.stripe_checkout_session_id)
            db.refresh(payment)
            return payment
        if session.get("payment_status") == "paid":
            apply_session(db, session)
            db.refresh(payment)
            return payment

    payment.status = "cancelled"
    payment.updated_at = _now()
    db.commit()
    return payment
