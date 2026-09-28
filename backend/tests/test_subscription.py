"""Reading and changing the signed-in researcher's plan.

There is no payment yet, so the rules worth pinning are the ones that stay true once
there is: the row is always the caller's own, an unknown plan is refused, Free never
carries a billing period, and choosing the plan you are on changes nothing.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user
from app.main import app
from app.models.subscription import Subscription

OWNER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"


class FakeSession:
    def __init__(self, rows: dict | None = None):
        self.rows = rows or {}
        self.commits = 0

    def get(self, model, key):
        return self.rows.get((model, str(key)))

    def add(self, obj):
        self.rows[(type(obj), str(obj.owner_id))] = obj

    def commit(self):
        self.commits += 1


@pytest.fixture
def client_for():
    def build(db: FakeSession, user: str = OWNER) -> TestClient:
        app.dependency_overrides[get_current_user] = lambda: {"sub": user}
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()


def _row(**overrides) -> Subscription:
    then = datetime(2026, 9, 1, tzinfo=timezone.utc)
    values = dict(
        owner_id=uuid.UUID(OWNER),
        plan_id="researcher",
        billing="monthly",
        status="active",
        started_at=then,
        renews_at=then,
        updated_at=then,
    )
    values.update(overrides)
    return Subscription(**values)


def test_an_account_with_no_row_is_on_free(client_for):
    body = client_for(FakeSession()).get("/api/subscription").json()

    assert body["plan_id"] == "free"
    assert body["renews_at"] is None


def test_upgrading_records_the_plan_and_a_renewal_date(client_for):
    db = FakeSession()
    response = client_for(db).put(
        "/api/subscription", json={"plan_id": "lab", "billing": "annual"}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["plan_id"], body["billing"]) == ("lab", "annual")
    assert body["renews_at"] is not None
    assert db.get(Subscription, OWNER).plan_id == "lab"


def test_free_never_carries_a_billing_period(client_for):
    db = FakeSession({(Subscription, OWNER): _row()})
    body = client_for(db).put(
        "/api/subscription", json={"plan_id": "free", "billing": "annual"}
    ).json()

    assert body["billing"] == "monthly"
    assert body["renews_at"] is None


def test_choosing_the_current_plan_changes_nothing(client_for):
    row = _row()
    db = FakeSession({(Subscription, OWNER): row})
    client_for(db).put("/api/subscription", json={"plan_id": "researcher", "billing": "monthly"})

    assert db.commits == 0
    assert row.started_at == datetime(2026, 9, 1, tzinfo=timezone.utc)


def test_an_unknown_plan_is_refused(client_for):
    response = client_for(FakeSession()).put(
        "/api/subscription", json={"plan_id": "enterprise"}
    )
    assert response.status_code == 422


def test_each_caller_only_ever_sees_their_own_row(client_for):
    db = FakeSession({(Subscription, OWNER): _row(plan_id="lab")})
    body = client_for(db, user=STRANGER).get("/api/subscription").json()

    assert body["plan_id"] == "free"
