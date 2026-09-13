"""Agent 4's output size is its speed, so the things that control it are tested.

Output tokens per minute is the binding rate limit on verification, so every token the
model writes is time the researcher waits. Two settings dominate, and both were wrong:

* reasoning_effort. Measured on the real prompt, qwen3.8-27b spends 372 completion
  tokens at "low" and 159 at "none" for the same answer. It does not reject "low" the
  way qwen3.6 does - it quietly treats it as full reasoning. A global "low", correct for
  gpt-oss, was therefore costing 2.3x here.
* The shape of the JSON. An array of objects repeated the keys "criterion", "status" and
  "evidence" once per criterion, and the model was asked for a prose note that Python
  already writes for itself.
"""

from __future__ import annotations

import pytest

from app.agents.verification.agent import _iter_checks, _parse_llm_output
from app.agents.verification.prompts import SYSTEM_PROMPT
from app.core.config import Settings, settings
from app.schemas.verification import CheckStatus

CANONICAL = ["population", "condition", "intervention", "exclude:type 1 diabetes"]


# --- reasoning effort is per model ----------------------------------------------------


def test_qwen_is_asked_for_no_reasoning():
    """The whole 2.3x. "low" is not rejected here, it is silently expensive."""
    assert settings.reasoning_effort_for("qwen/qwen3.8-27b") == "none"
    assert settings.reasoning_effort_for("qwen/qwen3.6-27b") == "none"


def test_gpt_oss_keeps_low():
    """Where "low" really is the cheap end, it must survive."""
    assert settings.reasoning_effort_for("openai/gpt-oss-20b") == "low"
    assert settings.reasoning_effort_for("openai/gpt-oss-120b") == "low"


def test_an_unlisted_model_falls_back_to_the_default():
    assert settings.reasoning_effort_for("some/new-model") == settings.llm_reasoning_effort


def test_the_override_map_is_configurable():
    custom = Settings(llm_reasoning_effort_by_model="a/b=high,c/d=none", llm_reasoning_effort="low")
    assert custom.reasoning_effort_for("a/b") == "high"
    assert custom.reasoning_effort_for("c/d") == "none"
    assert custom.reasoning_effort_for("e/f") == "low"


def test_a_malformed_override_does_not_break_the_call():
    custom = Settings(llm_reasoning_effort_by_model="garbage,,=,x=", llm_reasoning_effort="low")
    assert custom.reasoning_effort_for("anything") == "low"


# --- the prompt asks for the compact shape --------------------------------------------


def test_the_prompt_asks_for_a_map_and_a_short_quote():
    assert '"checks": {' in SYSTEM_PROMPT, "an object keyed by criterion, not an array"
    assert "8 WORDS" in SYSTEM_PROMPT
    assert '"note"' not in SYSTEM_PROMPT, "Python composes the note; asking costs tokens"


# --- the parser reads it, and still reads the old shape -------------------------------


def test_the_compact_map_is_parsed():
    raw = {
        "decision": "EXCLUDE",
        "checks": {
            "population": ["FAIL", "210 children"],
            "condition": ["PASS", "type 2 diabetes"],
            "intervention": ["UNCLEAR", ""],
        },
        "issues": [],
    }
    checks, decision, issues, note = _parse_llm_output(raw, CANONICAL)

    by_name = {c.criterion: c for c in checks}
    assert by_name["population"].status is CheckStatus.FAIL
    assert by_name["population"].evidence == "210 children"
    assert by_name["intervention"].status is CheckStatus.UNCLEAR
    assert decision is not None and decision.value == "EXCLUDE"
    assert issues == [] and note == ""


def test_the_old_array_shape_still_works():
    """A model that ignores the format should be slower, never broken."""
    raw = {
        "decision": "INCLUDE",
        "checks": [
            {"criterion": "population", "status": "PASS", "evidence": "480 adults"},
        ],
    }
    checks, _, _, _ = _parse_llm_output(raw, CANONICAL)
    assert checks[0].criterion == "population"
    assert checks[0].evidence == "480 adults"


def test_a_bare_status_map_is_accepted():
    """Some models drop the evidence slot entirely; that is a status, not a failure."""
    checks, _, _, _ = _parse_llm_output({"checks": {"population": "PASS"}}, CANONICAL)
    assert checks[0].status is CheckStatus.PASS
    assert checks[0].evidence == ""


@pytest.mark.parametrize("garbage", [None, [], {}, "nonsense", 42])
def test_malformed_checks_never_crash_the_pass(garbage):
    assert _iter_checks(garbage) == [] or isinstance(_iter_checks(garbage), list)


def test_an_unusable_status_becomes_unclear_not_a_guess():
    """Not judging a criterion must not be read as judging it either way."""
    checks, _, _, _ = _parse_llm_output(
        {"checks": {"population": ["MAYBE", "something"]}}, CANONICAL
    )
    assert checks[0].status is CheckStatus.UNCLEAR
