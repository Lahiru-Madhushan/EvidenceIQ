"""Paying for a plan: a plan is granted only for money Stripe confirms, and only once.

Stripe is replaced by a small fake that keeps checkout sessions in a dict and answers
the four calls billing makes, so these tests exercise the real HTTP client, the real
router and a real (in-memory) database - everything except the network.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import get_current_user
from app.main import app
from app.models.payment import Payment
from app.models.subscription import Subscription
from app.services import billing, stripe_client

OWNER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"
WEBHOOK_SECRET = "whsec_test_secret"


# --- a fake Stripe -----------------------------------------------------------------------


class FakeStripe:
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.created: list[dict] = []
        self.idempotency_keys: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer sk_test_fake"
        path = request.url.path
        if request.method == "POST" and path == "/v1/checkout/sessions":
            form = dict(parse_qsl(request.content.decode()))
            self.created.append(form)
            self.idempotency_keys.append(request.headers.get("idempotency-key", ""))
            session_id = f"cs_test_{uuid.uuid4().hex}"
            self.sessions[session_id] = {
                "id": session_id,
                "url": f"https://checkout.stripe.com/c/pay/{session_id}",
                "status": "open",
                "payment_status": "unpaid",
                "amount_total": int(form["line_items[0][price_data][unit_amount]"]),
                "currency": form["line_items[0][price_data][currency]"],
                "metadata": {
                    key[len("metadata[") : -1]: value
                    for key, value in form.items()
                    if key.startswith("metadata[")
                },
                "payment_intent": None,
            }
            return httpx.Response(200, json=self.sessions[session_id])

        match = re.fullmatch(r"/v1/checkout/sessions/(cs_test_\w+)(/expire)?", path)
        if match and match.group(1) in self.sessions:
            session = self.sessions[match.group(1)]
            if match.group(2):
                if session["status"] != "open":
                    return httpx.Response(400, json={"error": {"message": "not open"}})
                session["status"] = "expired"
            return httpx.Response(200, json=session)
        return httpx.Response(404, json={"error": {"message": "No such session"}})

    def pay(self, session_id: str, *, amount: int | None = None) -> None:
        session = self.sessions[session_id]
        session.update(status="complete", payment_status="paid")
        if amount is not None:
            session["amount_total"] = amount
        session["payment_intent"] = {
            "id": "pi_test_123",
            "latest_charge": {
                "receipt_url": "https://pay.stripe.com/receipts/test",
                "payment_method_details": {"card": {"brand": "visa", "last4": "4242"}},
            },
        }


@pytest.fixture
def stripe(monkeypatch):
    fake = FakeStripe()
    transport = httpx.MockTransport(fake.handle)
    monkeypatch.setattr(
        stripe_client, "_http_client", lambda: httpx.AsyncClient(transport=transport)
    )
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_fake")
    monkeypatch.setattr(settings, "stripe_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "public_app_url", "https://app.example")
    return fake


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine, tables=[Payment.__table__, Subscription.__table__])
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture
def client_for(db):
    def build(user: str = OWNER) -> TestClient:
        app.dependency_overrides[get_current_user] = lambda: {"sub": user, "email": "r@example.org"}
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()


def _checkout(client, plan="researcher", billing_period="monthly"):
    response = client.post("/api/payments/checkout", json={"plan_id": plan, "billing": billing_period})
    assert response.status_code == 201, response.text
    return response.json()


def _session_of(stripe: FakeStripe, checkout: dict) -> str:
    return checkout["checkout_url"].rsplit("/", 1)[1]


def _signed(event: dict, *, secret: str = WEBHOOK_SECRET, at: int | None = None) -> tuple[bytes, str]:
    body = json.dumps(event).encode()
    timestamp = str(at if at is not None else int(time.time()))
    signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return body, f"t={timestamp},v1={signature}"


# --- prices --------------------------------------------------------------------------------


def test_backend_prices_match_what_the_pricing_page_shows():
    plans_js = (Path(__file__).parents[2] / "frontend" / "src" / "lib" / "plans.js").read_text("utf-8")
    shown = {
        plan_id: {"monthly": int(monthly), "annual": int(annual)}
        for plan_id, monthly, annual in re.findall(
            r"id: '(\w+)'.*?price: \{ monthly: (\d+), annual: (\d+) \}", plans_js, re.S
        )
    }
    assert shown.pop("free") == {"monthly": 0, "annual": 0}
    assert shown == billing.PRICES_USD


def test_annual_is_the_discounted_rate_charged_for_twelve_months():
    assert billing.amount_cents("researcher", "monthly") == 2900
    assert billing.amount_cents("researcher", "annual") == 24 * 12 * 100


# --- checkout ------------------------------------------------------------------------------


def test_checkout_records_a_pending_payment_priced_by_the_server(client_for, stripe, db):
    body = _checkout(client_for(), "lab", "annual")

    payment = db.get(Payment, uuid.UUID(body["payment_id"]))
    assert payment.status == "pending"
    assert payment.amount_cents == 82 * 12 * 100
    sent = stripe.created[0]
    assert sent["line_items[0][price_data][unit_amount]"] == str(payment.amount_cents)
    assert sent["metadata[owner_id]"] == OWNER
    assert sent["success_url"].startswith("https://app.example/subscription?checkout=success")
    assert "{CHECKOUT_SESSION_ID}" in sent["success_url"]
    assert stripe.idempotency_keys == [f"checkout-{payment.id}"]
    # Nothing is granted for starting a checkout.
    assert db.get(Subscription, uuid.UUID(OWNER)) is None


def test_the_client_cannot_set_the_price_or_buy_free(client_for, stripe):
    client = client_for()
    tampered = client.post(
        "/api/payments/checkout", json={"plan_id": "lab", "billing": "monthly", "amount_cents": 1}
    )
    assert tampered.status_code == 201
    assert stripe.created[0]["line_items[0][price_data][unit_amount]"] == "9900"

    assert client.post("/api/payments/checkout", json={"plan_id": "free"}).status_code == 422


def test_without_stripe_keys_paid_plans_say_so(client_for, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    response = client_for().post("/api/payments/checkout", json={"plan_id": "lab"})
    assert response.status_code == 503
    assert "not set up" in response.json()["detail"]


# --- confirming --------------------------------------------------------------------------


def test_a_paid_checkout_grants_the_plan_and_records_the_receipt(client_for, stripe, db):
    client = client_for()
    session_id = _session_of(stripe, _checkout(client, "researcher", "annual"))
    stripe.pay(session_id)

    response = client.post("/api/payments/confirm", json={"session_id": session_id})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["payment"]["status"] == "paid"
    assert (body["payment"]["card_brand"], body["payment"]["card_last4"]) == ("visa", "4242")
    assert body["payment"]["receipt_url"].startswith("https://pay.stripe.com/")
    assert (body["subscription"]["plan_id"], body["subscription"]["billing"]) == ("researcher", "annual")
    renews = datetime.fromisoformat(body["subscription"]["renews_at"].replace("Z", "+00:00"))
    if renews.tzinfo is None:
        renews = renews.replace(tzinfo=timezone.utc)
    assert timedelta(days=364) < renews - datetime.now(timezone.utc) <= timedelta(days=365)


def test_an_unpaid_checkout_grants_nothing(client_for, stripe, db):
    client = client_for()
    session_id = _session_of(stripe, _checkout(client))

    body = client.post("/api/payments/confirm", json={"session_id": session_id}).json()

    assert body["payment"]["status"] == "pending"
    assert body["subscription"]["plan_id"] == "free"


def test_confirming_twice_never_extends_the_plan_twice(client_for, stripe, db):
    client = client_for()
    session_id = _session_of(stripe, _checkout(client))
    stripe.pay(session_id)

    first = client.post("/api/payments/confirm", json={"session_id": session_id}).json()
    second = client.post("/api/payments/confirm", json={"session_id": session_id}).json()

    assert first["subscription"]["renews_at"] == second["subscription"]["renews_at"]


def test_renewing_early_adds_to_the_time_already_paid_for(client_for, stripe, db):
    ends = datetime.now(timezone.utc) + timedelta(days=10)
    db.add(Subscription(owner_id=uuid.UUID(OWNER), plan_id="researcher", billing="monthly",
                        status="active", started_at=ends - timedelta(days=30), renews_at=ends,
                        updated_at=ends))
    db.commit()
    client = client_for()
    session_id = _session_of(stripe, _checkout(client, "researcher", "monthly"))
    stripe.pay(session_id)

    client.post("/api/payments/confirm", json={"session_id": session_id})

    renews_at = db.get(Subscription, uuid.UUID(OWNER)).renews_at
    renews_at = renews_at.replace(tzinfo=timezone.utc) if renews_at.tzinfo is None else renews_at
    assert abs(renews_at - (ends + timedelta(days=30))) < timedelta(seconds=5)


def test_a_charge_that_does_not_match_the_price_grants_nothing(client_for, stripe, db):
    client = client_for()
    session_id = _session_of(stripe, _checkout(client, "lab"))
    stripe.pay(session_id, amount=100)

    body = client.post("/api/payments/confirm", json={"session_id": session_id}).json()

    assert body["payment"]["status"] == "failed"
    assert body["subscription"]["plan_id"] == "free"


def test_someone_elses_checkout_cannot_be_confirmed(client_for, stripe, db):
    session_id = _session_of(stripe, _checkout(client_for(OWNER)))
    stripe.pay(session_id)

    response = client_for(STRANGER).post("/api/payments/confirm", json={"session_id": session_id})

    assert response.status_code == 404
    assert db.get(Subscription, uuid.UUID(STRANGER)) is None


def test_a_malformed_session_id_is_refused_before_reaching_stripe(client_for, stripe):
    response = client_for().post("/api/payments/confirm", json={"session_id": "../../charges"})
    assert response.status_code == 422


# --- cancelling ---------------------------------------------------------------------------


def test_leaving_without_paying_is_recorded_and_closes_the_checkout(client_for, stripe, db):
    client = client_for()
    checkout = _checkout(client)

    body = client.post(f"/api/payments/{checkout['payment_id']}/cancel").json()

    assert body["status"] == "cancelled"
    assert stripe.sessions[_session_of(stripe, checkout)]["status"] == "expired"


def test_a_cancel_that_raced_a_payment_records_the_payment(client_for, stripe, db):
    client = client_for()
    checkout = _checkout(client)
    stripe.pay(_session_of(stripe, checkout))

    body = client.post(f"/api/payments/{checkout['payment_id']}/cancel").json()

    assert body["status"] == "paid"


def test_someone_elses_payment_cannot_be_cancelled(client_for, stripe):
    checkout = _checkout(client_for(OWNER))
    response = client_for(STRANGER).post(f"/api/payments/{checkout['payment_id']}/cancel")
    assert response.status_code == 404


# --- history ------------------------------------------------------------------------------


def test_history_lists_only_the_callers_payments(client_for, stripe):
    _checkout(client_for(OWNER))
    _checkout(client_for(STRANGER), "lab")

    mine = client_for(OWNER).get("/api/payments").json()

    assert [p["plan_id"] for p in mine] == ["researcher"]
    assert "card_number" not in mine[0]


# --- webhook ------------------------------------------------------------------------------


def test_a_signed_webhook_records_the_payment(client_for, stripe, db):
    session_id = _session_of(stripe, _checkout(client_for()))
    stripe.pay(session_id)
    body, signature = _signed(
        {"type": "checkout.session.completed", "data": {"object": {"id": session_id}}}
    )

    app.dependency_overrides.pop(get_current_user)  # Stripe has no user token
    response = TestClient(app).post(
        "/api/payments/webhook", content=body, headers={"Stripe-Signature": signature}
    )

    assert response.json() == {"received": True, "handled": True}
    assert db.get(Subscription, uuid.UUID(OWNER)).plan_id == "researcher"


def test_the_webhook_trusts_stripe_not_the_event_body(client_for, stripe, db):
    """A signed event saying "paid" grants nothing while Stripe's API says unpaid."""
    session_id = _session_of(stripe, _checkout(client_for()))
    body, signature = _signed({
        "type": "checkout.session.completed",
        "data": {"object": {"id": session_id, "payment_status": "paid"}},
    })

    TestClient(app).post("/api/payments/webhook", content=body, headers={"Stripe-Signature": signature})

    assert db.get(Subscription, uuid.UUID(OWNER)) is None


@pytest.mark.parametrize(
    "secret,age",
    [("whsec_wrong", 0), (WEBHOOK_SECRET, 3600)],
    ids=["forged", "replayed"],
)
def test_a_forged_or_replayed_webhook_is_refused(client_for, stripe, db, secret, age):
    session_id = _session_of(stripe, _checkout(client_for()))
    stripe.pay(session_id)
    body, signature = _signed(
        {"type": "checkout.session.completed", "data": {"object": {"id": session_id}}},
        secret=secret,
        at=int(time.time()) - age,
    )

    response = TestClient(app).post(
        "/api/payments/webhook", content=body, headers={"Stripe-Signature": signature}
    )

    assert response.status_code == 400
    assert db.get(Subscription, uuid.UUID(OWNER)) is None


def test_an_unsigned_webhook_is_refused(stripe):
    response = TestClient(app).post("/api/payments/webhook", content=b"{}")
    assert response.status_code == 400


def test_other_event_types_are_acknowledged_and_ignored(client_for, stripe):
    client_for()
    body, signature = _signed({"type": "customer.created", "data": {"object": {"id": "cus_1"}}})
    response = TestClient(app).post(
        "/api/payments/webhook", content=body, headers={"Stripe-Signature": signature}
    )
    assert response.json() == {"received": True, "handled": False}


def test_an_expired_checkout_is_recorded(client_for, stripe, db):
    checkout = _checkout(client_for())
    session_id = _session_of(stripe, checkout)
    stripe.sessions[session_id]["status"] = "expired"
    body, signature = _signed({"type": "checkout.session.expired", "data": {"object": {"id": session_id}}})

    TestClient(app).post("/api/payments/webhook", content=body, headers={"Stripe-Signature": signature})

    assert db.get(Payment, uuid.UUID(checkout["payment_id"])).status == "expired"


# --- the stripe client's encoding ----------------------------------------------------------


def test_nested_params_use_stripes_bracket_encoding():
    assert stripe_client._form(
        {"line_items": [{"quantity": 1, "price_data": {"currency": "usd"}}], "mode": "payment"}
    ) == [
        ("line_items[0][quantity]", "1"),
        ("line_items[0][price_data][currency]", "usd"),
        ("mode", "payment"),
    ]
