"""One agent on a different provider, without moving the others.

Agent 4 sits on Gemini while Agents 1 and 3 and both chat features stay on Groq. That is
only safe if "which provider" is a property of the model rather than of the application,
so what is tested here is the seam: a model that was not moved must resolve exactly as it
did before, and a model that was must carry its own key, URL and budgets.

The budgets matter as much as the key. Groq's free tier is 8000 tokens a minute and
200000 a day; Gemini's is shaped completely differently. Applying one provider's meter to
the other throttles it to a fraction of what it allows, or waves calls through that it
will refuse - and the pacer exists precisely so that neither happens.
"""

from __future__ import annotations

from app.core.config import Settings, check_agent_models, AgentModelConflict

import pytest


def _settings(**overrides) -> Settings:
    base = dict(
        llm_api_key="groq-key",
        llm_base_url="https://api.groq.com/openai/v1",
        gemini_api_key="gemini-key",
        gemini_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        llm_provider_by_model="gemini-3.6-flash=gemini",
    )
    base.update(overrides)
    return Settings(**base)


# --- which provider serves a model ----------------------------------------------------


def test_a_mapped_model_uses_that_providers_key_and_url():
    key, url = _settings().provider_for("gemini-3.6-flash")
    assert key == "gemini-key"
    assert "generativelanguage.googleapis.com" in url


def test_an_unmapped_model_is_untouched():
    """The whole point: moving one agent must not move the others."""
    config = _settings()
    for model in ("openai/gpt-oss-20b", "openai/gpt-oss-120b", "anything/else"):
        key, url = config.provider_for(model)
        assert key == "groq-key"
        assert url == "https://api.groq.com/openai/v1"


def test_a_mapped_provider_with_no_key_does_not_borrow_the_default_one():
    """Sending a Groq key to Google fails with a message about the wrong thing.

    The authentication error it produces says nothing about the real mistake, which is
    that GEMINI_API_KEY was never set. An empty key reaches the client's own check and
    that one names the missing setting.
    """
    key, _ = _settings(gemini_api_key="").provider_for("gemini-3.6-flash")
    assert key == ""


def test_an_unknown_provider_name_falls_back_rather_than_crashing():
    """A typo in the mapping must not take the server down at import time."""
    key, url = _settings(llm_provider_by_model="x=notaprovider").provider_for("x")
    assert key == "groq-key"
    assert url == "https://api.groq.com/openai/v1"


# --- budgets are per model too --------------------------------------------------------


def test_a_listed_model_gets_its_own_budgets():
    config = _settings(
        llm_tokens_per_minute=8000,
        llm_tokens_per_day=200_000,
        llm_tokens_per_minute_by_model="gemini-3.6-flash=250000",
        llm_tokens_per_day_by_model="gemini-3.6-flash=4000000",
    )
    assert config.tokens_per_minute_for("gemini-3.6-flash") == 250_000
    assert config.tokens_per_day_for("gemini-3.6-flash") == 4_000_000


def test_an_unlisted_model_keeps_the_global_budget():
    config = _settings(
        llm_tokens_per_day=200_000, llm_tokens_per_day_by_model="gemini-3.6-flash=4000000"
    )
    assert config.tokens_per_day_for("openai/gpt-oss-20b") == 200_000


def test_zero_means_not_metered_rather_than_unset():
    """Gemini publishes no separate output-per-minute limit.

    Reading a listed 0 as "missing" would fall back to Groq's 1000 OTPM and throttle a
    provider that does not have that limit at all - which is how a setting meant to
    describe one plan silently applies to another.
    """
    config = _settings(
        llm_output_tokens_per_minute=1000,
        llm_output_tokens_per_minute_by_model="gemini-3.6-flash=0",
    )
    assert config.output_tokens_per_minute_for("gemini-3.6-flash") == 0
    assert config.output_tokens_per_minute_for("openai/gpt-oss-20b") == 1000


@pytest.mark.parametrize("bad", ["gemini-3.6-flash=abc", "gemini-3.6-flash=", "garbage"])
def test_an_unusable_budget_falls_back_instead_of_removing_pacing(bad):
    """A typo must not silently disable the rate limiter - that is how 429s return."""
    config = _settings(llm_tokens_per_day=200_000, llm_tokens_per_day_by_model=bad)
    assert config.tokens_per_day_for("gemini-3.6-flash") == 200_000


# --- the reason the two agents are on different models at all -------------------------


def test_gemini_is_asked_for_no_reasoning():
    """Measured against the live API, and not the same thing as sending nothing.

    Gemini 3 reasons by default. At "none" a verification costs 91 completion tokens;
    omitting the parameter entirely answers 503 rather than defaulting to something
    cheap, because the model spends the whole budget thinking and returns empty content.
    So this must be "none" - an empty value here would break Agent 4 outright.
    """
    from app.core.config import settings

    assert settings.reasoning_effort_for("gemini-3.6-flash") == "none"
    assert settings.reasoning_effort_for(settings.verification_model) == "none"


def test_the_two_agents_are_still_required_to_differ():
    """Changing provider must not weaken the rule that makes agreement mean something."""
    with pytest.raises(AgentModelConflict):
        check_agent_models(
            _settings(screening_model="same/model", verification_model="same/model")
        )


def test_the_shipped_defaults_keep_the_agents_off_each_others_quotas():
    """Which model an agent uses is also a decision about who it competes with.

    Quotas are per model, so two agents on one model share one budget. Agents 3 and 4 are
    already kept apart by check_agent_models, for a different and stronger reason - two
    agents on one model share its blind spots. Agent 1 is not covered by that rule but
    needs the same separation for the quota reason alone: it runs once per review while
    Agent 4 runs once per paper, so sharing would let a long screening run leave the
    researcher unable to start a new review at all.
    """
    from app.core.config import settings

    check_agent_models(settings)
    assert settings.verification_model != settings.criteria_model, (
        "Agent 4 is back on Agent 1's model; a long run will exhaust the quota that "
        "starting a new review depends on"
    )
    assert settings.verification_model != settings.chat_model


def test_a_second_vendor_stays_reachable_even_though_nothing_uses_it():
    """The escape hatch has to still work on the day a Groq model is retired.

    Nothing is pointed at Gemini by default - qwen benchmarked better on the real
    verification prompt - but gemini-2.5-flash being refused for newly issued keys is
    exactly the kind of thing that makes this matter, and an untested fallback is not one.
    """
    from app.core.config import settings

    key, url = settings.provider_for("gemini-3.6-flash")
    assert "generativelanguage.googleapis.com" in url
    assert settings.reasoning_effort_for("gemini-3.6-flash") == "none"


def test_the_missing_key_error_names_the_right_variable():
    """"Set LLM_API_KEY" is wrong advice for a model on another provider.

    Following it produces an authentication failure instead of a fix, so the message has
    to name the variable the reader actually needs.
    """
    config = _settings()
    assert config.key_setting_for("gemini-3.6-flash") == "GEMINI_API_KEY"
    assert config.key_setting_for("openai/gpt-oss-20b") == "LLM_API_KEY"
