"""Sanitising untrusted text before it reaches an LLM.

Abstracts come from PubMed and criteria come from researchers - neither is trusted
input. The defence is layered: normalise and strip the characters that let text hide or
impersonate structure, neutralise anything imitating the prompt's own section markers,
cap the length, and *flag* (never silently delete) anything that reads like an
instruction. Isolation itself comes from the prompt, which fences this text inside
delimiters and tells the model it is data rather than instructions.

The injection check is a denylist, and a denylist cannot be complete - a paraphrase will
always exist that it does not know. It is written to catch the families of wording seen
in practice (overrides, role-play, prompt extraction, messages addressed to the model,
decision steering and fake protocol blocks), and a match only ever adds a flag. The
guarantee does not rest on it: it rests on the fencing, on output validation, and on
Agent 4 re-checking on a different model family.
"""

from __future__ import annotations

import re
import unicodedata

# C0/C1 control characters, except the whitespace worth keeping.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]")
# Zero-width and bidirectional-override characters: invisible, and usable to smuggle text.
_INVISIBLE_CHARS = re.compile(r"[​-‏‪-‮⁠-⁤﻿]")
_EXCESS_BLANK_LINES = re.compile(r"\n{3,}")

# The section markers the prompts use to fence untrusted text. Text that contains one of
# these could close its own fence and write outside it, so they are defanged in the data.
_FENCE_TAG = re.compile(
    r"</?\s*(?:paper|protocol|context|document|hints|screening_result|conversation_so_far"
    r"|system|instructions?|assistant|user)\s*>",
    re.IGNORECASE,
)
# The screening prompt fences the abstract in triple quotes.
_TRIPLE_QUOTES = re.compile(r'"{3,}')

_I = re.IGNORECASE | re.MULTILINE

# Wording typical of prompt injection. A match never blocks the request - it is recorded
# on the result so the paper reaches a human with the reason attached.
#
# Every pattern here is phrased as something said TO a model, not something a paper
# says about the world. Medical prose is full of near misses - "physicians ignore
# guidelines", "metformin may act as a protective agent", "patients who satisfied all
# criteria", "reviewers rated the study as high quality" - and a detector that flags
# those floods the researcher with false alarms until they stop reading any of them.
# tests/test_security_hardening.py holds real-abstract sentences that must stay clean.
_INJECTION_PATTERNS = [
    re.compile(pattern, _I)
    for pattern in (
        # Instruction override.
        r"\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\b",
        r"\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:your|these|those|the\s+above|the\s+following"
        r"|the\s+system|the\s+original)\s+(?:instructions?|rules|guidelines|prompts?|criteria|protocol)\b",
        r"\b(?:ignore|disregard|forget)\s+(?:all|any)\s+(?:instructions?|rules|guidelines|prompts?)\b",
        r"\bnew\s+(?:instructions?|rules|task)\s*[:\-]",
        r"\b(?:protocol|criteria|instructions?)\s+(?:update|override)\s*:",
        r"\bapply\s+this\s+(?:protocol|criteria|rule)\s+instead\b",
        r"\bdo\s+not\s+(?:apply|use|follow)\s+(?:the\s+)?(?:exclusion|inclusion|protocol|screening)\s+(?:list|criteria|rules?)\b",
        # Role-play and jailbreak framing.
        r"\b(?:you\s+are\s+now|from\s+now\s+on,?\s+you|pretend\s+(?:to\s+be|you\s+are)|act\s+as\s+if\s+you)\b",
        r"\bact\s+as\s+(?:an?\s+)?(?:ai|assistant|chatbot|unrestricted|different)\s+(?:model|assistant|ai)?\b",
        r"\b(?:developer|admin(?:istrator)?|god|debug|jailbreak|unrestricted)\s+mode\b",
        r"\bjailbr(?:eak|oken)\b",
        # Prompt extraction.
        r"\b(?:system|developer)\s*(?:prompt|message|instructions?)\b",
        r"\b(?:reveal|print|show|repeat|output|display|leak|tell\s+me)\s+(?:me\s+)?(?:your\s+(?:\w+\s+)?(?:prompt|instructions?|rules)"
        r"|the\s+(?:system|hidden|initial|original)\s+(?:prompt|instructions?))\b",
        # Text addressed to the model rather than to a reader of a paper.
        r"\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+)?(?:reviewing\s+|screening\s+|verification\s+)?"
        r"(?:model|ai|assistant|llm|chatbot|language\s+model)\b",
        r"\b(?:dear|hey)\s+(?:ai|model|assistant|llm|chatgpt|gpt)\b",
        # Steering the decision itself.
        r"\b(?:always|must)\s+(?:include|exclude|accept|approve)\s+this\s+(?:paper|study|article)\b",
        r"\b(?:mark|rate|record|label|classify|treat)\s+this\s+(?:paper|study|article|abstract|record)\s+as\s+"
        r"(?:eligible|included?|relevant|meeting)",
        r"\brecord\s+the\s+(?:decision|verdict)\s+as\b",
        r"\bthis\s+(?:paper|study|article)\s+satisf(?:y|ies)\s+(?:every|all)\s+(?:criterion|criteria)\b",
        r"\boverride\s+(?:the\s+)?(?:protocol|criteria|decision)\b",
        r"[\"'](?:decision|verdict)[\"']\s*:\s*[\"'](?:include|exclude)",
        # Fake conversation turns.
        r"^\s*(?:system|assistant)\s*:",
    )
] + [
    # Case-sensitive on purpose: "Dan" is a surname in author lists.
    re.compile(r"\bDAN\b(?=.{0,40}\b(?:mode|prompt|jailbreak|anything)\b)", re.DOTALL),
]

_INJECTION_FLAG = (
    "Possible prompt-injection wording detected in the source text; it was "
    "treated as data only. Manual review recommended."
)


def looks_like_injection(text: str) -> bool:
    """True when the text contains wording typical of prompt injection.

    Checked on two readings of the text: with invisible characters removed, and with
    them turned into spaces. "IGNORE​ALL​PREVIOUS" becomes one unbroken word
    under the first reading, which is how the original check was evaded; the second
    reading restores the word boundaries.
    """
    folded = unicodedata.normalize("NFKC", text or "")
    readings = {_INVISIBLE_CHARS.sub("", folded), _INVISIBLE_CHARS.sub(" ", folded)}
    return any(pattern.search(reading) for reading in readings for pattern in _INJECTION_PATTERNS)


def neutralise_fences(text: str) -> tuple[str, bool]:
    """Defang anything that imitates the prompt's own section markers."""
    changed = False

    def angle(match: re.Match[str]) -> str:
        return match.group(0).replace("<", "‹").replace(">", "›")

    new = _FENCE_TAG.sub(angle, text)
    new = _TRIPLE_QUOTES.sub('"', new)
    if new != text:
        changed = True
    return new, changed


def sanitize_text(raw: str | None, *, max_chars: int) -> tuple[str, list[str]]:
    """Return cleaned text plus human-readable flags describing what was found."""
    flags: list[str] = []
    if not raw:
        return "", flags

    # NFKC folds compatibility and look-alike forms to their canonical characters, so a
    # full-width "ｉｇｎｏｒｅ　ａｌｌ　ｐｒｅｖｉｏｕｓ" cannot slip past the patterns below.
    text = unicodedata.normalize("NFKC", raw)

    # Decided before the invisible characters are removed: removing them first is what
    # used to fuse words together and hide the injection wording.
    injected = looks_like_injection(text)

    if _INVISIBLE_CHARS.search(text):
        flags.append("Removed zero-width or bidirectional control characters from the text.")
        text = _INVISIBLE_CHARS.sub("", text)

    if _CONTROL_CHARS.search(text):
        flags.append("Removed control characters from the text.")
        text = _CONTROL_CHARS.sub(" ", text)

    text, fenced = neutralise_fences(text)
    if fenced:
        flags.append(
            "Neutralised text imitating the prompt's own section markers, so it could "
            "not break out of the data block."
        )
        injected = True

    text = _EXCESS_BLANK_LINES.sub("\n\n", text).strip()

    if len(text) > max_chars:
        flags.append(f"Text truncated to {max_chars} characters before verification.")
        text = text[:max_chars].rstrip()

    if injected or looks_like_injection(text):
        flags.append(_INJECTION_FLAG)

    return text, flags


def clean_model_text(value: object, *, max_chars: int) -> str:
    """Model output headed for a researcher's screen: plain, bounded text.

    A model's "reason" or "answer" is untrusted too - an injected abstract can steer
    what it says. It is stripped of control and invisible characters and capped, so a
    runaway or manipulated response cannot fill the page or the database.
    """
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = _INVISIBLE_CHARS.sub("", text)
    text = _CONTROL_CHARS.sub(" ", text).strip()
    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "…"
    return text
