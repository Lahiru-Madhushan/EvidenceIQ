"""What a caller actually receives when the quota is gone.

The value of an accurate error is entirely in whether it survives the trip. This asserts
on the HTTP response, because every previous version of this failure was diagnosed
correctly inside the client and then flattened on the way out.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.main import app
from app.services.llm import LLMError, LLMQuotaExhausted

client = TestClient(app)

QUOTA_TEXT = (
    "The daily token quota for openai/gpt-oss-120b is spent; it has room again in "
    "about 9 minutes. This is a quota, not an outage."
)

PAYLOAD = {
    "paper": {
        "pmid": "123",
        "title": "A trial",
        "abstract": "Adults with type 2 diabetes were randomised.",
        "year": 2023,
        "publication_types": [],
    },
    "protocol": {"inclusion": {"population": "adults"}, "exclusion": {}},
    "screening_decision": {"decision": "INCLUDE", "reason": "relevant"},
}


@pytest.fixture(autouse=True)
def _auth():
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1"}
    yield
    app.dependency_overrides.clear()


def _patch_verify(monkeypatch, exc):
    async def boom(_request):
        raise exc

    monkeypatch.setattr("app.routers.verification.verify", boom)


def test_quota_exhaustion_is_429_with_the_real_reason(monkeypatch):
    _patch_verify(
        monkeypatch, LLMQuotaExhausted(QUOTA_TEXT, scope="day", wait_seconds=540.0)
    )

    response = client.post("/api/verify", json=PAYLOAD)

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert "daily token quota" in detail
    assert "9 minutes" in detail
    assert "unavailable" not in detail, "the accurate message must not be overwritten"
    assert response.headers["retry-after"] == "540"


def test_a_genuine_outage_is_still_502_and_still_vague(monkeypatch):
    """The generic message is right for the case it was written for - keep it there."""
    _patch_verify(monkeypatch, LLMError("connection reset by peer"))

    response = client.post("/api/verify", json=PAYLOAD)

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "unavailable" in detail
    # An outage must not leak the upstream's internals to the researcher.
    assert "connection reset" not in detail
