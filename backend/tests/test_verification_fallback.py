"""Agent 4 falls over to another model rather than leaving a paper half-checked.

Screening commits the moment Agent 3 finishes, so a spent Agent 3 budget costs the
researcher nothing they had already earned. A spent Agent 4 budget was different: every
remaining paper kept one opinion instead of two, and one opinion is exactly what this
agent exists to stop being enough. The router turns that into a slower paper.

What is tested here is the router's judgement rather than its plumbing - when it moves
on, when it refuses to, and the rule it must never break to do either.
"""

from __future__ import annotations

import asyncio

import pytest

from app.core.config import AgentModelConflict, Settings, check_agent_models
from app.services import llm
from app.services.llm import LLMError, LLMQuotaExhausted, complete_json_routed

ANSWER = {"decision": "INCLUDE", "checks": {"population": ["PASS", "240 adults"]}}


def _route(models, behaviour):
    """Run the router with `behaviour` deciding what each model does."""
    calls: list[str] = []

    async def fake_complete_json(*, system_prompt, user_prompt, model, **kwargs):
        calls.append(model)
        outcome = behaviour(model)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    original = llm.complete_json
    llm.complete_json = fake_complete_json
    try:
        result = asyncio.run(
            complete_json_routed(system_prompt="s", user_prompt="u", models=models)
        )
    finally:
        llm.complete_json = original
    return result, calls


def _quota(model):
    return LLMQuotaExhausted(
        f"The daily token quota for {model} is spent.", scope="day", wait_seconds=1800
    )


# --- when it moves on -----------------------------------------------------------------


def test_a_spent_quota_falls_over_to_the_next_model():
    """The case this exists for: qwen's day is gone, the paper still gets verified."""
    (payload, used), calls = _route(
        ["primary", "fallback"],
        lambda m: _quota(m) if m == "primary" else ANSWER,
    )

    assert payload == ANSWER
    assert used == "fallback"
    assert calls == ["primary", "fallback"]


def test_the_primary_is_used_whenever_it_can_answer():
    """The fallback is a fallback, not a load balancer."""
    (_, used), calls = _route(["primary", "fallback"], lambda m: ANSWER)

    assert used == "primary"
    assert calls == ["primary"], "the fallback was called although the primary answered"


def test_a_retired_or_broken_model_also_falls_over():
    """Not only quotas. A 404 for a model the provider withdrew is just as survivable."""
    (_, used), _ = _route(
        ["primary", "fallback"],
        lambda m: LLMError("HTTP 404: model no longer available") if m == "primary" else ANSWER,
    )

    assert used == "fallback"


def test_it_walks_the_whole_chain():
    (_, used), calls = _route(
        ["a", "b", "c"], lambda m: ANSWER if m == "c" else _quota(m)
    )

    assert used == "c"
    assert calls == ["a", "b", "c"]


# --- when it does not -----------------------------------------------------------------


def test_the_last_models_failure_is_the_one_reported():
    """With nowhere left to go, the caller needs the most recent reason, not the first."""
    with pytest.raises(LLMError) as caught:
        _route(["primary", "fallback"], lambda m: LLMError(f"{m} broke"))

    assert "fallback broke" in str(caught.value)


def test_a_quota_error_keeps_its_type_through_the_chain():
    """The routers above it read this: a 429 must not arrive as a generic failure.

    The per-paper endpoints turn LLMQuotaExhausted into 429 and everything else into 502,
    and the sequential harvest reads that status to decide whether to fetch another
    paper. Flattening the type here would tell it to keep going against a chain that is
    entirely spent.
    """
    with pytest.raises(LLMQuotaExhausted):
        _route(["primary", "fallback"], lambda m: _quota(m))


def test_an_empty_chain_is_refused_rather_than_silently_skipped():
    with pytest.raises(LLMError):
        asyncio.run(complete_json_routed(system_prompt="s", user_prompt="u", models=[]))


# --- the rule the chain must not break ------------------------------------------------


def _settings(**kw):
    base = dict(screening_model="agent3/model", verification_model="agent4/model",
                verification_model_fallbacks="")
    base.update(kw)
    return Settings(**base)


def test_a_fallback_may_not_be_agent_3s_model():
    """The quietest way to lose the property this whole system rests on.

    The chain only reaches its fallback once the primary quota is spent, so a fallback
    set to Agent 3's model removes independence part-way through a run - and every
    response still looks right. Refusing at startup is the only place this is visible.
    """
    with pytest.raises(AgentModelConflict) as caught:
        check_agent_models(_settings(verification_model_fallbacks="agent3/model"))

    assert "VERIFICATION_MODEL_FALLBACKS" in str(caught.value)


def test_a_legitimate_chain_starts_normally():
    check_agent_models(_settings(verification_model_fallbacks="other/model"))


def test_the_chain_drops_a_fallback_that_repeats_the_primary():
    """Asking a spent quota the same question twice is not a fallback."""
    config = _settings(verification_model_fallbacks="agent4/model,other/model")

    assert config.verification_chain == ["agent4/model", "other/model"]


def test_the_shipped_chain_is_valid_and_has_somewhere_to_fall_back_to():
    from app.core.config import settings

    check_agent_models(settings)
    assert len(settings.verification_chain) >= 2, "Agent 4 has no fallback configured"


# --- a 429 that names no wait is not a transient one -----------------------------------


def test_a_429_with_no_stated_wait_fails_immediately(monkeypatch):
    """Measured: one paper spent four of a 20-request daily allowance on one refusal.

    Groq always states "try again in 28.08s" for a budget that refills. Gemini answers an
    exhausted free-tier allowance with "check your plan and billing details" and no time
    at all, because there is no time at which it would succeed. Backing off blindly there
    spends the very requests the fallback exists to preserve, so it must fail on the
    first one and let the router move on.
    """
    import httpx

    from app.core.config import settings

    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_retries", 3)
    monkeypatch.setattr(settings, "llm_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_day", 0)
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute", 0)
    monkeypatch.setattr(settings, "llm_tokens_per_minute_by_model", "")
    monkeypatch.setattr(settings, "llm_tokens_per_day_by_model", "")
    monkeypatch.setattr(settings, "llm_output_tokens_per_minute_by_model", "")

    calls = {"n": 0}
    body = (
        '{"error":{"code":429,"message":"You exceeded your current quota, please check '
        'your plan and billing details. Quota exceeded for metric: '
        'generate_content_free_tier_requests, limit: 20"}}'
    )

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            calls["n"] += 1
            return httpx.Response(429, text=body)

    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda *a, **k: FakeClient())

    with pytest.raises(LLMQuotaExhausted):
        asyncio.run(
            llm.complete_json(system_prompt="s", user_prompt="u", model="some/model")
        )

    assert calls["n"] == 1, (
        f"{calls['n']} requests spent on a refusal that named no retry time; "
        "against a 20-per-day allowance that is 20% of the budget on one paper"
    )


def test_a_refusal_with_no_reset_time_reads_as_a_plan_limit():
    """"needs about 0 seconds, longer than this request can wait" reads as a bug.

    It is not one - it is a provider declining to name a reset because there is no time
    at which the request would succeed. The message has to say that, because the reader's
    next action (wait for tomorrow, upgrade, add a fallback) is nothing like the action
    for a burst limit.
    """
    from app.services.llm import _quota_message
    from app.services.rate_limit import BudgetExhausted

    message = _quota_message("some/model", BudgetExhausted("minute", 0.0))

    assert "0 seconds" not in message
    assert "daily free-tier limit" in message
    assert "VERIFICATION_MODEL_FALLBACKS" in message


# --- how independent the answer actually was ------------------------------------------


def test_vendor_is_judged_by_family_not_by_size():
    """Two checkpoints of one lineage are not two opinions.

    gpt-oss-20b and gpt-oss-120b differ in parameter count, which is not the property
    that matters - they share training data, so they share blind spots. The comparison
    has to be coarse enough to say so.
    """
    from app.core.config import settings

    assert settings.vendor_of("openai/gpt-oss-20b") == settings.vendor_of("openai/gpt-oss-120b")
    assert settings.vendor_of("qwen/qwen3.8-27b") != settings.vendor_of("openai/gpt-oss-20b")
    assert settings.vendor_of("gemini-3.6-flash") == settings.vendor_of("gemini-2.5-flash")
    assert settings.vendor_of("gemini-3.6-flash") != settings.vendor_of("openai/gpt-oss-20b")


def test_the_chain_is_ordered_most_independent_first():
    """A fallback order is a ranking of how much the answer can be trusted.

    Ordering by speed would put the models that share Agent 3's lineage first, which
    quietly spends the strongest second opinions last - exactly backwards.
    """
    from app.core.config import settings

    agent3 = settings.vendor_of(settings.screening_model)
    same_family = [
        settings.vendor_of(m) == agent3 for m in settings.verification_chain
    ]
    assert same_family == sorted(same_family), (
        f"chain {settings.verification_chain} puts a model sharing Agent 3's family "
        "ahead of an independent one"
    )
    assert not same_family[0], "the primary must not share Agent 3's model family"


# --- what the researcher is shown -----------------------------------------------------


def _verify_with_model(monkeypatch, answering_model):
    """Run the real agent, forcing a given model to be the one that answers."""
    import asyncio as _asyncio

    from app.agents.verification.agent import verify
    from app.core.config import settings
    from app.schemas.paper import Paper
    from app.schemas.protocol import DateRange, Protocol
    from app.schemas.screening import Decision, ScreeningDecision
    from app.schemas.verification import VerifyRequest

    payload = {
        "decision": "INCLUDE",
        "checks": {
            "population": ["PASS", "240 adults"],
            "condition": ["PASS", "type 2 diabetes"],
            "intervention": ["PASS", "aerobic exercise"],
            "exclude:type 1 diabetes": ["PASS", "type 1 excluded"],
        },
        "issues": [],
    }

    async def routed(*, system_prompt, user_prompt, models, **kwargs):
        return payload, answering_model

    monkeypatch.setattr(
        "app.agents.verification.agent.complete_json_routed", routed
    )

    paper = Paper(
        pmid="1",
        title="Aerobic exercise in adults with type 2 diabetes",
        abstract="We randomised 240 adults with type 2 diabetes to aerobic exercise.",
        year=2023,
        publication_types=["Randomized Controlled Trial"],
    )
    protocol = Protocol(
        population="Adults", condition="Type 2 diabetes", intervention="Aerobic exercise",
        date_range=DateRange(from_year=2015, to_year=2026), excludes=["type 1 diabetes"],
    )
    request = VerifyRequest(
        paper=paper,
        protocol=protocol,
        screening_decision=ScreeningDecision(pmid="1", decision=Decision.INCLUDE, reason=""),
    )
    return _asyncio.run(verify(request)), settings


def test_routing_notes_never_reach_the_researchers_flag_list(monkeypatch):
    """`issues` is rendered as "Flagged during verification" and means paper problems.

    Which model answered is a fact about this system's plumbing on one afternoon. Listed
    beside unsupported claims and injected instructions it sends someone to re-read a
    paper nothing is wrong with, and buries the flags that do need them.
    """
    result, settings = _verify_with_model(monkeypatch, "openai/gpt-oss-120b")

    joined = " ".join(result.issues).lower()
    assert "model family" not in joined
    assert "could not be reached" not in joined
    assert "gpt-oss" not in joined
    assert result.issues == [], result.issues


def test_the_model_is_still_recorded_where_it_belongs(monkeypatch):
    """Removed from the reading, not from the record."""
    result, _ = _verify_with_model(monkeypatch, "openai/gpt-oss-120b")

    assert result.model == "openai/gpt-oss-120b"


def test_a_same_family_fallback_still_costs_confidence(monkeypatch):
    """The independence cost is real, so it lands on the queue order instead.

    Everything about this paper is clean - every criterion passed with a quote - so the
    only thing that can hold it below HIGH is the model that answered.
    """
    same_family, settings = _verify_with_model(monkeypatch, "openai/gpt-oss-120b")
    independent, _ = _verify_with_model(monkeypatch, settings.verification_model)

    assert independent.confidence.value == "HIGH"
    assert same_family.confidence.value == "MEDIUM"
