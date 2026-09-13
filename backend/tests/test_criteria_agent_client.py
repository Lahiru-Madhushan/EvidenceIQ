"""Agent 1 must be subject to the same budget as everyone else spending it.

It had its own copy of the HTTP client, and the copy had drifted: the same 30-second
backoff cap that Agents 3 and 4 no longer use, no awareness of the shared token budget,
and a 502 for a spent quota. So it kept retrying inside a wait the provider had told it
was over two minutes long, then reported the model as broken.

The duplicate is gone; these tests hold it to the shared behaviour.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from conftest import install_virtual_clock
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import get_current_user
from app.main import app
from app.services import criteria_agent as agent_module
from app.services import llm as llm_module
from app.services.criteria_agent import (
    CriteriaAgentError,
    CriteriaQuotaExhausted,
    interpret_criteria,
)
from app.services.llm import reset_learned_limits
from app.services.rate_limit import reset_buckets

# Verbatim from the logs - the call that spent 60 seconds retrying before giving up.
TPD_BODY = json.dumps(
    {
        "error": {
            "message": (
                "Rate limit reached for model `openai/gpt-oss-120b` in organization "
                "`org_01m20pqxrvev5rh25wd6cn2y59` service tier `on_demand` on tokens per "
                "day (TPD): Limit 200000, Used 199666, Requested 657. Please try again "
                "in 2m19.536s."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    }
)

READY_ANSWER = {
    "choices": [
        {
            "finish_reason": "stop",
            "message": {
                "content": json.dumps(
                    {"status": "ready", "protocol": {"inclusion": {}, "exclusion": {}}}
                )
            },
        }
    ],
    "usage": {"total_tokens": 657},
}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    reset_learned_limits()
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_max_wait_seconds", 75.0)
    # Pacing is off by default here so the budget does not wait in its own loop; the
    # one test that cares about the budget turns it back on.
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    # A sleep must move the clock, or a bucket waiting on a refill spins forever.
    install_virtual_clock(monkeypatch, llm_module)
    yield
    reset_learned_limits()
    reset_buckets()



def _transport(monkeypatch, handler):
    sent: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return handler(len(sent))

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        llm_module.httpx,
        "AsyncClient",
        lambda *a, **k: real_client(*a, **{**k, "transport": httpx.MockTransport(responder)}),
    )
    return sent


def _interpret():
    return asyncio.run(
        interpret_criteria(
            research_question="Does metformin improve glycaemic control?",
            raw_criteria="Adults with type 2 diabetes, randomised trials only.",
        )
    )


def test_the_duplicate_client_is_gone():
    """The drift was only possible because there were two clients to drift apart."""
    assert not hasattr(agent_module, "_call_groq")
    assert not hasattr(agent_module, "GROQ_MODEL"), "the model belongs in config"


def test_the_model_comes_from_config(monkeypatch):
    monkeypatch.setattr(settings, "criteria_model", "some/other-model")
    sent = _transport(monkeypatch, lambda _n: httpx.Response(200, json=READY_ANSWER))
    _interpret()
    assert sent[0]["model"] == "some/other-model"


def test_a_spent_quota_fails_immediately_with_the_real_reason(monkeypatch):
    """It used to retry twice at 30s inside a 2m19s wait, then report a broken model."""
    sent = _transport(monkeypatch, lambda _n: httpx.Response(429, text=TPD_BODY))

    with pytest.raises(CriteriaQuotaExhausted) as caught:
        _interpret()

    assert len(sent) == 1, "no retrying inside a wait we were told we cannot afford"
    assert "daily token quota" in str(caught.value)
    assert caught.value.wait_seconds == pytest.approx(139.536)


def test_an_ordinary_failure_is_still_a_plain_agent_error(monkeypatch):
    _transport(monkeypatch, lambda _n: httpx.Response(500, text="upstream exploded"))
    with pytest.raises(CriteriaAgentError) as caught:
        _interpret()
    assert not isinstance(caught.value, CriteriaQuotaExhausted)


def test_agent_1_shares_the_budget_with_whoever_else_uses_that_model(monkeypatch):
    """The point of one client: Agent 1's spending is visible to Agent 4's pacing."""
    monkeypatch.setattr(settings, "criteria_model", "shared/model")
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 8000)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 200_000)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 1000)
    _transport(monkeypatch, lambda _n: httpx.Response(200, json=READY_ANSWER))

    _interpret()

    from app.services.rate_limit import budget_for

    budget = budget_for("shared/model", 8000, 200_000, 1000)
    # Something was actually charged against the shared bucket for this call.
    assert budget.minute.wait_for(8000) > 0


# --- and what the researcher receives -------------------------------------------------


@pytest.fixture
def _auth():
    app.dependency_overrides[get_current_user] = lambda: {"sub": "user-1"}
    yield
    app.dependency_overrides.clear()


def test_submit_returns_429_not_502_when_the_quota_is_spent(_auth, monkeypatch):
    async def boom(**_kwargs):
        raise CriteriaQuotaExhausted(
            "The daily token quota for openai/gpt-oss-120b is spent; it has room again "
            "in about 2 minutes.",
            wait_seconds=139.536,
        )

    monkeypatch.setattr("app.routers.criteria.interpret_criteria", boom)

    response = TestClient(app).post(
        "/api/criteria/submit",
        json={"research_question": "Does metformin work?", "raw_criteria": "Adults, RCTs."},
    )

    assert response.status_code == 429
    assert "daily token quota" in response.json()["detail"]
    assert response.headers["retry-after"] == "139"
