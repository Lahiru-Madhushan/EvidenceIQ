"""A signed-in researcher sees their own reviews through the criteria router, and no one else's.

The other half of V-01: requiring a token is not enough if any token can read any
review. These pin the ownership rules on the two read handlers.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user
from app.main import app
from app.models.review import Review

OWNER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"


def _review(owner: str, question: str) -> Review:
    now = datetime.now(timezone.utc)
    return Review(
        id=uuid.uuid4(),
        owner_id=uuid.UUID(owner),
        research_question=question,
        raw_criteria="criteria",
        status="draft",
        created_at=now,
        updated_at=now,
    )


class FakeQuery:
    """Enough of Query for list_reviews: filter by owner, order, all."""

    def __init__(self, rows):
        self._rows = rows

    def filter(self, condition):
        wanted = condition.right.value
        return FakeQuery([row for row in self._rows if row.owner_id == wanted])

    def order_by(self, *_):
        return self

    def all(self):
        return list(self._rows)


class FakeSession:
    def __init__(self, rows):
        self._rows = rows

    def get(self, model, key):
        return next((row for row in self._rows if str(row.id) == str(key)), None)

    def query(self, model):
        return FakeQuery(self._rows)


@pytest.fixture
def reviews():
    return [_review(OWNER, "mine"), _review(STRANGER, "theirs")]


@pytest.fixture
def client_as(reviews):
    def build(user: str) -> TestClient:
        app.dependency_overrides[get_current_user] = lambda: {"sub": user}
        app.dependency_overrides[get_db] = lambda: FakeSession(reviews)
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()


def test_the_list_holds_only_the_callers_reviews(client_as):
    body = client_as(OWNER).get("/api/criteria/").json()

    assert [row["research_question"] for row in body] == ["mine"]


def test_an_owner_can_read_their_review(client_as, reviews):
    response = client_as(OWNER).get(f"/api/criteria/{reviews[0].id}")

    assert response.status_code == 200
    assert response.json()["research_question"] == "mine"


def test_someone_elses_review_is_indistinguishable_from_a_missing_one(client_as, reviews):
    """404 for both, so the endpoint cannot be used to learn which ids exist."""
    theirs = client_as(OWNER).get(f"/api/criteria/{reviews[1].id}")
    missing = client_as(OWNER).get(f"/api/criteria/{uuid.uuid4()}")

    assert theirs.status_code == missing.status_code == 404
    assert theirs.json() == missing.json()
