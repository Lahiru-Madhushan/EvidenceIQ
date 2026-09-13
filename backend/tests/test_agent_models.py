"""Agents 3 and 4 must never share an LLM.

This is the one property the four-agent design exists to provide: if both agents run on
the same model they share its blind spots, and `agreement` stops being evidence that a
paper was independently confirmed. Nothing else in the system fails when that happens -
no test breaks, no response looks wrong - so it is checked here and at startup.
"""

from __future__ import annotations

import pytest

from app.core.config import AgentModelConflict, Settings, check_agent_models, settings


def test_screening_and_verification_use_different_models():
    assert settings.screening_model != settings.verification_model


def test_both_agents_name_their_model_rather_than_inheriting_the_default():
    """A model inherited from llm_model is a model that can change by accident."""
    from app.agents.screening.agent import SCREENING_MODEL

    assert SCREENING_MODEL == settings.screening_model
    # Agent 4 passing settings.verification_model is asserted through the call itself
    # in test_verification_passes_its_own_model below.


def test_check_rejects_a_shared_model():
    clashing = Settings(
        screening_model="openai/gpt-oss-20b",
        verification_model="openai/gpt-oss-20b",
    )
    with pytest.raises(AgentModelConflict) as exc:
        check_agent_models(clashing)
    assert "different models" in str(exc.value)


def test_check_accepts_distinct_models():
    fine = Settings(
        screening_model="openai/gpt-oss-20b",
        verification_model="openai/gpt-oss-120b",
    )
    check_agent_models(fine)  # must not raise


def test_verification_passes_its_own_model():
    """Agent 4 must send verification_model, not whatever llm_model happens to be."""
    import asyncio

    from app.agents.verification import verify
    from app.schemas.paper import Paper
    from app.schemas.protocol import Protocol
    from app.schemas.screening import Decision, ScreeningDecision
    from app.schemas.verification import VerifyRequest

    seen: dict = {}

    async def spy_llm(**kwargs):
        seen.update(kwargs)
        return {
            "decision": "INCLUDE",
            "checks": [],
            "issues": [],
            "note": "stub",
        }

    request = VerifyRequest(
        paper=Paper(pmid="1", title="t", abstract="adults with type 2 diabetes", year=2024),
        protocol=Protocol(population="adults", condition="type 2 diabetes"),
        screening_decision=ScreeningDecision(pmid="1", decision=Decision.INCLUDE),
    )
    asyncio.run(verify(request, llm=spy_llm))

    assert seen.get("model") == settings.verification_model
    assert seen.get("model") != settings.screening_model
