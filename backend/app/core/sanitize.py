"""Sanitising untrusted text before it reaches an LLM.

Abstracts come from PubMed and criteria come from researchers - neither is trusted
input. The defence is layered: normalise and strip the characters that let text hide or
impersonate structure, cap the length, and *flag* (never silently delete) anything that
reads like an instruction. Isolation itself comes from the prompt, which fences this
text inside delimiters and tells the model it is data rather than instructions.
"""

from __future__ import annotations

import re
import unicodedata

# C0/C1 control characters, except the whitespace worth keeping.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]")
# Zero-width and bidirectional-override characters: invisible, and usable to smuggle text.
_INVISIBLE_CHARS = re.compile(r"[​-\u200F\u202A-\u202E⁠-⁤﻿]")
_EXCESS_BLANK_LINES = re.compile(r"\n{3,}")

# Wording typical of prompt injection. A match never blocks the request - it is recorded
# on the result so the paper reaches a human with the reason attached.
_INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\b",
        r"\bdisregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\b",
        r"\b(?:you\s+are\s+now|from\s+now\s+on\s+you)\b",
        r"\b(?:system|developer)\s*(?:prompt|message|instructions?)\b",
        r"\bnew\s+instructions?\b",
        r"\b(?:always|must)\s+(?:include|exclude)\s+this\s+(?:paper|study|article)\b",
        r"\boverride\s+(?:the\s+)?(?:protocol|criteria|decision)\b",
    )
]


def sanitize_text(raw: str | None, *, max_chars: int) -> tuple[str, list[str]]:
    """Return cleaned text plus human-readable flags describing what was found."""
    flags: list[str] = []
    if not raw:
        return "", flags

    # NFKC folds compatibility and look-alike forms to their canonical characters, so a
    # full-width "ｉｇｎｏｒｅ　ａｌｌ　ｐｒｅｖｉｏｕｓ" cannot slip past the patterns below.
    text = unicodedata.normalize("NFKC", raw)

    if _INVISIBLE_CHARS.search(text):
        flags.append("Removed zero-width or bidirectional control characters from the text.")
        text = _INVISIBLE_CHARS.sub("", text)

    if _CONTROL_CHARS.search(text):
        flags.append("Removed control characters from the text.")
        text = _CONTROL_CHARS.sub(" ", text)

    text = _EXCESS_BLANK_LINES.sub("\n\n", text).strip()

    if len(text) > max_chars:
        flags.append(f"Text truncated to {max_chars} characters before verification.")
        text = text[:max_chars].rstrip()

    if any(pattern.search(text) for pattern in _INJECTION_PATTERNS):
        flags.append(
            "Possible prompt-injection wording detected in the source text; it was "
            "treated as data only. Manual review recommended."
        )

    return text, flags
