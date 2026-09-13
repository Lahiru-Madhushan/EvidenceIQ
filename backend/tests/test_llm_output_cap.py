"""Running out of completion budget must not look like an unavailable model.

Both failures below are copied from real logs. They matter because gpt-oss spends the
completion cap on reasoning before writing any JSON, so "the cap was too small" is a
routine, recoverable condition - but in JSON mode the provider reports it as a 400,
which is the status class the client treats as fatal. Left unhandled it surfaced to the
researcher as "the verification model is unavailable", which was never true.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from conftest import install_virtual_clock

from app.core.config import settings
from app.services import llm as llm_module
from app.services.llm import LLMError, complete_json, reset_learned_limits
from app.services.rate_limit import reset_buckets

MODEL = "openai/gpt-oss-120b"

# Groq's reply when the model hit the cap mid-document.
CAP_REACHED_BODY = json.dumps(
    {
        "error": {
            "message": "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
            "type": "invalid_request_error",
            "code": "json_validate_failed",
            "failed_generation": "max completion tokens reached before generating a valid document",
        }
    }
)

# The same condition, reported the other way: nothing usable came back at all.
EMPTY_GENERATION_BODY = json.dumps(
    {
        "error": {
            "message": "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
            "type": "invalid_request_error",
            "code": "json_validate_failed",
            "failed_generation": "",
        }
    }
)

GOOD_ANSWER = {
    "choices": [
        {
            "finish_reason": "stop",
            "message": {
                "content": json.dumps(
                    {"decision": "INCLUDE", "checks": [], "issues": [], "note": "ok"}
                )
            },
        }
    ],
    "usage": {"total_tokens": 900},
}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Each test starts with no learned state, no pacing, and no real backoff."""
    reset_learned_limits()
    reset_buckets()
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    # Pacing is tested elsewhere; every budget off here, or the stubbed sleep below
    # spins against a real clock waiting for tokens that only wall time can refill.
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_max_output_tokens", 1600)
    monkeypatch.setattr(settings, "llm_max_output_ceiling", 6144)
    monkeypatch.setattr(settings, "llm_reasoning_effort", "low")
    # A sleep must move the clock, or a bucket waiting on a refill spins forever.
    install_virtual_clock(monkeypatch, llm_module)
    yield
    reset_learned_limits()
    reset_buckets()



def install_transport(monkeypatch, handler):
    """Route the client's requests to `handler`, recording every payload sent."""
    sent: list[dict] = []

    def responder(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        sent.append(payload)
        return handler(len(sent), payload)

    real_client = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(responder)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(llm_module.httpx, "AsyncClient", patched)
    return sent


def call():
    return asyncio.run(complete_json(system_prompt="sys", user_prompt="usr", model=MODEL))


def test_cap_failure_retries_with_a_doubled_cap(monkeypatch):
    """The exact 400 from the logs must be recovered, not reported as a dead model."""

    def handler(n, _payload):
        if n == 1:
            return httpx.Response(400, text=CAP_REACHED_BODY)
        return httpx.Response(200, json=GOOD_ANSWER)

    sent = install_transport(monkeypatch, handler)
    assert call()["decision"] == "INCLUDE"
    assert [p["max_tokens"] for p in sent] == [1600, 3200]


def test_empty_generation_is_treated_the_same_way(monkeypatch):
    def handler(n, _payload):
        if n == 1:
            return httpx.Response(400, text=EMPTY_GENERATION_BODY)
        return httpx.Response(200, json=GOOD_ANSWER)

    sent = install_transport(monkeypatch, handler)
    assert call()["decision"] == "INCLUDE"
    assert [p["max_tokens"] for p in sent] == [1600, 3200]


def test_a_truncated_200_escalates_too(monkeypatch):
    """The other shape: a 200 that stopped at the cap with unclosed JSON."""
    truncated = {
        "choices": [{"finish_reason": "length", "message": {"content": '{"decision":'}}],
        "usage": {"total_tokens": 1600},
    }

    def handler(n, _payload):
        return httpx.Response(200, json=truncated if n == 1 else GOOD_ANSWER)

    sent = install_transport(monkeypatch, handler)
    assert call()["decision"] == "INCLUDE"
    assert [p["max_tokens"] for p in sent] == [1600, 3200]


def test_escalation_is_remembered_for_the_next_paper(monkeypatch):
    """A cap discovered once must not be rediscovered at the cost of another call."""

    def handler(n, payload):
        if payload["max_tokens"] < 3200:
            return httpx.Response(400, text=CAP_REACHED_BODY)
        return httpx.Response(200, json=GOOD_ANSWER)

    sent = install_transport(monkeypatch, handler)
    call()  # first paper pays for the discovery
    call()  # second must start where the first ended up
    assert [p["max_tokens"] for p in sent] == [1600, 3200, 3200]


def test_escalation_stops_at_the_ceiling_with_an_actionable_error(monkeypatch):
    def handler(_n, _payload):
        return httpx.Response(400, text=CAP_REACHED_BODY)

    sent = install_transport(monkeypatch, handler)
    with pytest.raises(LLMError) as caught:
        call()

    assert [p["max_tokens"] for p in sent] == [1600, 3200, 6144]
    message = str(caught.value)
    assert "6144" in message
    assert "LLM_MAX_OUTPUT_CEILING" in message
    # The researcher-facing cause, not a generic "model unavailable".
    assert "complete JSON" in message


def test_reasoning_effort_is_sent_when_configured(monkeypatch):
    sent = install_transport(monkeypatch, lambda _n, _p: httpx.Response(200, json=GOOD_ANSWER))
    call()
    assert sent[0]["reasoning_effort"] == "low"


def test_blank_reasoning_effort_is_not_sent(monkeypatch):
    monkeypatch.setattr(settings, "llm_reasoning_effort", "")
    sent = install_transport(monkeypatch, lambda _n, _p: httpx.Response(200, json=GOOD_ANSWER))
    call()
    assert "reasoning_effort" not in sent[0]


def test_an_unsupported_reasoning_effort_is_dropped_not_fatal(monkeypatch):
    """An optional tuning parameter must never be what fails a verification."""
    refusal = json.dumps(
        {"error": {"message": "unknown parameter: reasoning_effort", "type": "invalid_request_error"}}
    )

    def handler(n, payload):
        if "reasoning_effort" in payload:
            return httpx.Response(400, text=refusal)
        return httpx.Response(200, json=GOOD_ANSWER)

    sent = install_transport(monkeypatch, handler)
    assert call()["decision"] == "INCLUDE"
    assert "reasoning_effort" in sent[0] and "reasoning_effort" not in sent[1]

    # And it is not sent again for this model on a later call.
    assert call()["decision"] == "INCLUDE"
    assert "reasoning_effort" not in sent[2]


def test_a_genuine_client_error_still_fails_fast(monkeypatch):
    """Escalation must not turn every 400 into three wasted calls."""
    body = json.dumps({"error": {"message": "model `nope` does not exist", "type": "invalid_request_error"}})
    sent = install_transport(monkeypatch, lambda _n, _p: httpx.Response(400, text=body))

    with pytest.raises(LLMError) as caught:
        call()
    assert len(sent) == 1
    assert "1 attempt(s)" in str(caught.value)


def test_attempt_count_in_the_error_is_the_real_one(monkeypatch):
    """The old message always claimed the maximum, whatever actually happened."""
    sent = install_transport(monkeypatch, lambda _n, _p: httpx.Response(503, text="upstream down"))

    with pytest.raises(LLMError) as caught:
        call()
    assert len(sent) == 4
    assert "4 attempt(s)" in str(caught.value)
