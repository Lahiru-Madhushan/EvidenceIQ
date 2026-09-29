"""Checks on what a chat model says before a researcher sees it.

The chat prompts already tell the model to answer only from the paper, to quote it, and
never to discuss its own instructions. A prompt is a request, not a control, so the
properties that matter are enforced here, in code, on the model's output:

* grounded means quoted - an answer is only presented as coming from the document when
  at least one of its quotes was found in the document verbatim;
* no prompt leakage - an answer that reproduces the system prompt is replaced;
* bounded output - answer and quotes are capped and stripped of control characters.
"""

from __future__ import annotations

import re

from app.core.sanitize import clean_model_text

MAX_ANSWER_CHARS = 2000
MAX_QUOTE_CHARS = 500
MAX_QUOTES = 5

# Twelve consecutive words of the system prompt appearing in an answer is not a
# coincidence - no paper or reasonable answer reuses the prompt's own sentences.
_LEAK_SHINGLE = 12
_WORD = re.compile(r"[a-z0-9']+")

LEAK_REFUSAL = (
    "I can't share my instructions, but I'm happy to help with questions about this "
    "paper or document."
)


def _shingles(text: str, size: int) -> set[tuple[str, ...]]:
    words = _WORD.findall(text.lower())
    return {tuple(words[i : i + size]) for i in range(len(words) - size + 1)}


def leaks_prompt(answer: str, system_prompt: str) -> bool:
    """True when the answer reproduces a run of the system prompt."""
    if not answer or not system_prompt:
        return False
    return bool(_shingles(answer, _LEAK_SHINGLE) & _shingles(system_prompt, _LEAK_SHINGLE))


def guard_answer(
    *,
    answer: object,
    grounded: bool,
    verified_quotes: list[str],
    system_prompt: str,
) -> tuple[str, bool, list[str]]:
    """Return (answer, grounded, quotes) with the output properties enforced."""
    text = clean_model_text(answer, max_chars=MAX_ANSWER_CHARS)
    quotes = [clean_model_text(q, max_chars=MAX_QUOTE_CHARS) for q in verified_quotes][:MAX_QUOTES]
    quotes = [q for q in quotes if q]

    if leaks_prompt(text, system_prompt):
        return LEAK_REFUSAL, False, []

    # A claim to be grounded is only believed with evidence behind it. The model saying
    # "grounded": true while quoting nothing is exactly how an answer from memory would
    # be dressed up as an answer from the paper.
    if grounded and not quotes:
        grounded = False

    return text, grounded, quotes
