"""Quick Chat answers from the uploaded document, and from nothing else.

The retrieval here is not a performance trick. A full paper is around 11,000 tokens and
one call's budget is 8,000, so the whole document cannot travel with a question even
once - only the passages it is about can. That makes two things worth testing: that the
right passages are found, and that an answer built from extracts never claims to have
read the whole work.
"""

from __future__ import annotations

import asyncio

import pytest

from app.services.document_text import (
    CONTEXT_BUDGET_CHARS,
    DocumentError,
    chunk,
    extract_text,
    normalise,
    select_context,
)
from app.services.quick_chat import answer_from_document, build_user_prompt, title_for


def long_paper() -> str:
    filler = lambda topic, n: " ".join(
        f"{topic} sentence {i} of background material." for i in range(n)
    )
    return normalise(
        "\n\n".join(
            [
                "Abstract. A randomised trial of metformin in adults with type 2 diabetes.",
                "Introduction. " + filler("Epidemiology", 300),
                "Methods. We enrolled 480 participants aged 18 to 75.",
                "Results. HbA1c fell by 1.2 percent versus 0.3 percent with placebo.",
                "Adverse events. Nausea occurred in 14 percent of participants.",
                "Discussion. " + filler("Comparison", 400),
                "Funding. Funded by the National Institute for Health Research.",
            ]
        )
    )


# --- reading the file -----------------------------------------------------------------


def test_plain_text_is_read():
    text, pages = extract_text(b"Hello, a short document.", "notes.txt")
    assert "short document" in text
    assert pages is None


def test_an_unsupported_type_is_refused_with_advice():
    with pytest.raises(DocumentError) as caught:
        extract_text(b"\x00\x01binary", "paper.docx")
    assert "PDF" in str(caught.value)


def test_hyphenated_line_breaks_are_repaired():
    """A word split by the typesetter would otherwise be unquotable."""
    assert "intervention" in normalise("the inter-\nvention was")


def test_wrapped_lines_become_sentences_but_paragraphs_survive():
    out = normalise("a wrapped\nline here\n\na new paragraph")
    assert "wrapped line here" in out
    assert "\n\n" in out


# --- finding the passage a question is about -------------------------------------------


@pytest.mark.parametrize(
    "question,needle",
    [
        ("How many participants were enrolled?", "480 participants"),
        ("What were the adverse events?", "Nausea occurred in 14 percent"),
        ("Who funded the study?", "National Institute for Health Research"),
        ("What happened to HbA1c?", "HbA1c fell by 1.2 percent"),
    ],
)
def test_retrieval_finds_the_answer_in_a_document_too_big_to_send(question, needle):
    paper = long_paper()
    assert len(paper) > CONTEXT_BUDGET_CHARS, "this test is pointless on a short document"

    context = select_context(paper, question)

    assert needle in context
    assert len(context) <= CONTEXT_BUDGET_CHARS


def test_a_document_that_fits_is_sent_whole():
    """Retrieval can only lose information, so it is used when it must be."""
    short = "A brief note about aspirin dosing."
    assert select_context(short, "what about aspirin?") == short


def test_chunks_overlap_so_a_straddling_sentence_stays_quotable():
    paragraph = "word " * 800
    chunks = chunk(paragraph)
    assert len(chunks) > 1
    assert any(chunks[0][-50:] in later for later in chunks[1:])


# --- the model is told what it is reading ----------------------------------------------


def test_extracts_are_labelled_as_extracts():
    """Otherwise "the paper does not mention X" is asserted from a few pages of it."""
    prompt = build_user_prompt(
        document_name="paper.pdf",
        context="some passages",
        partial=True,
        question="anything?",
        history=[],
    )
    assert "not the whole document" in prompt


def test_a_whole_document_is_not_labelled_as_extracts():
    prompt = build_user_prompt(
        document_name="paper.pdf",
        context="the whole thing",
        partial=False,
        question="anything?",
        history=[],
    )
    assert "not the whole document" not in prompt


def test_the_prompt_forbids_outside_knowledge():
    from app.services.quick_chat import SYSTEM_PROMPT

    assert "<document>" in SYSTEM_PROMPT
    assert "you have no other knowledge" in SYSTEM_PROMPT.lower()
    # The distinction that keeps a partial read honest.
    assert "never that the document as a whole" in SYSTEM_PROMPT


# --- quotes must really be quotes --------------------------------------------------------


def ask(reply, document="We enrolled 480 participants aged 18 to 75.", question="How many?"):
    async def fake_llm(**_kwargs):
        return reply

    return asyncio.run(
        answer_from_document(
            document_text=document, document_name="p.txt", question=question, llm=fake_llm
        )
    )


def test_a_fabricated_quote_is_dropped():
    result = ask(
        {
            "answer": "480 took part.",
            "grounded": True,
            "quotes": ["We enrolled 480 participants", "and 90 withdrew"],
        }
    )
    assert result["quotes"] == ["We enrolled 480 participants"]


def test_an_answer_whose_every_quote_is_fabricated_stops_being_sourced():
    result = ask({"answer": "90 withdrew.", "grounded": True, "quotes": ["90 withdrew"]})
    assert result["grounded"] is False
    assert result["quotes"] == []


def test_a_refusal_with_no_quotes_is_left_alone():
    result = ask({"answer": "This document does not say.", "grounded": False, "quotes": []})
    assert result["grounded"] is False
    assert "does not say" in result["answer"]


@pytest.mark.parametrize("reply", [{}, {"answer": None}, {"quotes": "not a list"}])
def test_malformed_model_output_does_not_crash(reply):
    result = ask(reply)
    assert isinstance(result["answer"], str) and result["answer"]
    assert result["grounded"] is False


def test_an_empty_document_is_answered_without_calling_the_model():
    called = False

    async def fail(**_kwargs):
        nonlocal called
        called = True
        return {}

    result = asyncio.run(
        answer_from_document(
            document_text="   ", document_name="x.pdf", question="anything?", llm=fail
        )
    )
    assert called is False
    assert result["grounded"] is False


# --- session titles ----------------------------------------------------------------------


def test_the_title_comes_from_the_file_name():
    assert title_for("metformin_trial_2023.pdf", "") == "metformin trial 2023"


def test_the_title_falls_back_to_the_first_question():
    assert title_for(None, "What was the sample size?") == "What was the sample size?"
