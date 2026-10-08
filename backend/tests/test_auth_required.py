"""Every endpoint refuses a caller with no token, except the few meant to be public.

The permanent form of test case TC-14 from the security assessment. V-01 was two GET
handlers on the criteria router that shipped without the auth dependency and served
every review in the database to anyone. A check per handler is easy to forget; this
test walks the whole OpenAPI schema instead, so a new route that forgets it fails here
before it can ship.
"""

from __future__ import annotations

import re
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app

# Public on purpose. Anything added here needs a reason.
#   /api/payments/webhook - Stripe is the caller and has no user token; it is
#   authenticated by its HMAC signature instead (tests/test_payments.py).
PUBLIC = {"/", "/api/health", "/api/payments/webhook"}

_PATH_PARAM = re.compile(r"\{[^}]+\}")


class NoDatabase:
    """Fails loudly if a handler reaches the database without authenticating first."""

    def __getattr__(self, name):
        raise AssertionError(f"database touched before authentication ({name})")


def _operations():
    schema = app.openapi()
    for path, operations in schema["paths"].items():
        if path in PUBLIC:
            continue
        for method in operations:
            yield method.upper(), path


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = lambda: NoDatabase()
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("method,path", sorted(_operations()))
def test_every_endpoint_requires_auth(client, method, path):
    url = _PATH_PARAM.sub(str(uuid.uuid4()), path)
    response = client.request(method, url)
    assert response.status_code == 401, f"{method} {path} answered {response.status_code} without a token"


def test_the_review_list_is_among_the_endpoints_checked():
    """Guards the test itself: if the schema walk found nothing, it would pass vacuously."""
    assert ("GET", "/api/criteria/") in set(_operations())
    assert ("GET", "/api/criteria/{review_id}") in set(_operations())
