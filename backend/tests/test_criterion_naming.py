"""The model does not always return the criterion names it was given.

Observed live with openai/gpt-oss-120b: asked for "population" it returns
"population: adults (18+)". Because _merge_checks grants a metadata rule precedence
only over an LLM check of the *same* name, a decorated name would let an LLM reading
of the abstract override an authoritative rule. These tests pin the normalisation.
"""

from __future__ import annotations

import asyncio

from app.agents.verification.agent import _canonicalise, verify
from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.schemas.verification import CheckSource, CheckStatus, VerifyRequest

PROTOCOL = Protocol(
    population="adults (18+)",
    condition="type 2 diabetes only",
    intervention="aerobic exercise",
    date_range={"from": 2015, "to": 2026},
    excludes=["animal studies", "type 1 diabetes"],
)

CANONICAL = [name for name, _ in PROTOCOL.inclusion_items()] + [
    name for name, _ in PROTOCOL.exclusion_items()
]

PAPER = Paper(
    pmid="1",
    title="A trial",
    abstract="Adults with type 2 diabetes completed an aerobic exercise programme.",
    year=2024,
    publication_types=["Randomized Controlled Trial"],
)


def stub_llm(payload):
    async def _call(**_kwargs):
        return payload

    return _call


def test_decorated_names_map_back_to_the_protocol_name():
    assert _canonicalise("population: adults (18+)", CANONICAL) == "population"
    assert _canonicalise("publication_date: 2015-2026", CANONICAL) == "publication_date"
    assert _canonicalise("  Condition  ", CANONICAL) == "condition"


def test_exclusion_names_keep_their_own_colon():
    assert _canonicalise("exclude:type 1 diabetes", CANONICAL) == "exclude:type 1 diabetes"
    assert (
        _canonicalise("exclude:type 1 diabetes: not present", CANONICAL)
        == "exclude:type 1 diabetes"
    )


def test_unknown_names_are_passed_through_unchanged():
    assert _canonicalise("funding_source", CANONICAL) == "funding_source"


def test_a_decorated_name_cannot_slip_past_a_metadata_rule():
    """The regression this normalisation exists for."""
    payload = {
        "decision": "INCLUDE",
        "checks": [
            # The rule already decided publication_date from metadata. Without
            # normalisation this decorated duplicate would survive the merge.
            {"criterion": "publication_date: 2015-2026", "status": "FAIL", "evidence": "2024"},
            {"criterion": "condition: type 2 diabetes only", "status": "PASS", "evidence": "type 2"},
        ],
        "issues": [],
        "note": "",
    }
    request = VerifyRequest(
        paper=PAPER,
        protocol=PROTOCOL,
        screening_decision=ScreeningDecision(decision="INCLUDE"),
    )
    result = asyncio.run(verify(request, llm=stub_llm(payload)))

    dates = [check for check in result.checks if check.criterion == "publication_date"]
    assert len(dates) == 1, "publication_date was reported twice"
    assert dates[0].source is CheckSource.RULE
    assert dates[0].status is CheckStatus.PASS
    # The rule held, so the paper is not excluded by the model's contradicting reading.
    assert result.verified_decision is Decision.INCLUDE


def test_duplicate_criteria_from_the_model_are_collapsed():
    payload = {
        "decision": "INCLUDE",
        "checks": [
            {"criterion": "condition", "status": "PASS", "evidence": "type 2 diabetes"},
            {"criterion": "condition: type 2 diabetes only", "status": "UNCLEAR", "evidence": ""},
        ],
        "issues": [],
        "note": "",
    }
    request = VerifyRequest(
        paper=PAPER,
        protocol=PROTOCOL,
        screening_decision=ScreeningDecision(decision="INCLUDE"),
    )
    result = asyncio.run(verify(request, llm=stub_llm(payload)))

    conditions = [check for check in result.checks if check.criterion == "condition"]
    assert len(conditions) == 1
    # First mention wins, so a later restatement cannot quietly downgrade it.
    assert conditions[0].status is CheckStatus.PASS
