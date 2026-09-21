"""Chat may answer from the paper in front of it, and from nothing else.

The value of this feature is entirely negative: it is worth having only because it will
not answer a question the paper does not answer. A confident sentence recalled from the
literature, in a tool whose output becomes a systematic review, is worse than silence.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services.paper_chat import (
    MAX_HISTORY_TURNS,
    answer_question,
    build_context,
    build_user_prompt,
    summarise,
)

PAPER = {
    "pmid": "38221190",
    "title": "Metformin in adults with type 2 diabetes: a randomised controlled trial",
    "abstract": "We randomised 480 adults aged 18-75 with type 2 diabetes to metformin or placebo.",
    "journal": "Diabetes Care",
    "year": 2023,
    "publication_types": ["Randomized Controlled Trial"],
    "draft_decision": "INCLUDE",
    "draft_reason": "An RCT in the target population",
    "verified_decision": "INCLUDE",
    "confidence": "HIGH",
    "verification_note": "All protocol criteria were confirmed.",
    "checks": [{"criterion": "design", "status": "PASS", "evidence": "We randomised 480 adults"}],
    "issues": [],
}
PROTOCOL = {"population": "Adults with type 2 diabetes", "intervention": "Metformin"}


def ask(question, reply, paper=PAPER, history=None):
    async def fake_llm(**_kwargs):
        return reply

    return asyncio.run(
        answer_question(
            paper=paper, protocol=PROTOCOL, question=question, history=history, llm=fake_llm
        )
    )


# --- the context is what the model is allowed to know --------------------------------


def test_the_context_carries_the_paper_and_what_the_agents_found():
    context = build_context(PAPER, PROTOCOL)
    assert "480 adults" in context
    assert "Diabetes Care" in context
    # "Why was this included?" is answerable because the checks travel with the paper.
    assert "criterion design: PASS" in context
    assert "Agent 4 (verification) independently said: INCLUDE" in context
    assert "Adults with type 2 diabetes" in context


def test_an_unverified_paper_says_so_rather_than_going_quiet():
    context = build_context({**PAPER, "verified_decision": None, "checks": []}, PROTOCOL)
    assert "Agent 4 has not verified this paper yet." in context


def test_the_prompt_forbids_outside_knowledge():
    from app.services.paper_chat import SYSTEM_PROMPT

    assert "<context>" in SYSTEM_PROMPT
    assert "grounded" in SYSTEM_PROMPT
    # The instruction that carries the whole feature.
    assert "You have no other knowledge" in SYSTEM_PROMPT


def test_history_is_trimmed_so_one_thread_cannot_grow_without_bound():
    history = [{"role": "user", "content": f"question {i}"} for i in range(30)]
    prompt = build_user_prompt("<context></context>", "and now?", history)
    assert prompt.count("Researcher:") <= MAX_HISTORY_TURNS


# --- a quote that is not in the paper is not a quote ---------------------------------


def test_a_fabricated_quote_is_dropped():
    """The one check that cannot be delegated to the model's good behaviour."""
    result = ask(
        "How many took part?",
        {
            "answer": "480 adults took part.",
            "grounded": True,
            "quotes": ["We randomised 480 adults", "and 200 dropped out by week 12"],
        },
    )
    assert result["quotes"] == ["We randomised 480 adults"]


def test_an_answer_whose_every_quote_is_fabricated_is_downgraded():
    """Claiming support it cannot produce must not be presented as sourced."""
    result = ask(
        "What was the dropout rate?",
        {"answer": "12 percent dropped out.", "grounded": True, "quotes": ["12 percent dropped out"]},
    )
    assert result["grounded"] is False
    assert result["quotes"] == []


def test_an_answer_with_no_quotes_offered_is_left_alone():
    """Not every true answer needs a quote - "the paper does not say" has none."""
    result = ask(
        "What were the adverse events?",
        {"answer": "This paper does not report adverse events.", "grounded": False, "quotes": []},
    )
    assert result["grounded"] is False
    assert result["answer"].startswith("This paper does not")


def test_an_empty_answer_never_reaches_the_researcher_as_a_finding():
    result = ask("Anything?", {"answer": "   ", "grounded": True, "quotes": []})
    assert result["grounded"] is False
    assert result["answer"]


@pytest.mark.parametrize("reply", [{}, {"answer": None}, {"quotes": "not a list"}])
def test_malformed_model_output_does_not_crash_the_endpoint(reply):
    result = ask("Anything?", reply)
    assert isinstance(result["answer"], str) and result["answer"]
    assert result["grounded"] is False


# --- the summary costs nothing and invents nothing ------------------------------------


def test_the_summary_is_extracted_not_generated():
    summary = summarise(PAPER)
    # Every word of the gist is the paper's own.
    assert summary["gist"] in PAPER["abstract"] or PAPER["abstract"].startswith(
        summary["gist"].rstrip(".")
    )
    assert summary["journal"] == "Diabetes Care"
    assert summary["has_abstract"] is True


def test_the_summary_handles_a_paper_with_no_abstract():
    summary = summarise({**PAPER, "abstract": ""})
    assert summary["gist"] == ""
    assert summary["has_abstract"] is False
