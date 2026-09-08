"""Evidence extraction for Agent 4.

This layer decides nothing. It pulls candidate spans out of the paper and hands them to
the LLM as *hints*, so the model has concrete phrases to quote rather than paraphrasing
the abstract from memory. Every hint is still checked against the paper text by the
model before it can become evidence, and a hint on its own never changes a status.

spaCy is optional. If spacy and a model are installed, its entities are added to the
hints; if not, the regex layer runs alone and nothing else changes. That keeps the
deployed image small while leaving the richer NER path available locally.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

SPACY_MODEL = "en_core_web_sm"

_AGE_PATTERNS = [
    re.compile(r"\baged?\s+(\d{1,3})\s*(?:-|--|to)\s*(\d{1,3})\b", re.IGNORECASE),
    re.compile(
        r"\b(?:mean|median|average)\s+age[^.]{0,30}?\d{1,3}(?:\.\d+)?\s*years?\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d{1,3}\s*(?:-|--|to)\s*\d{1,3}\s*years?\s+(?:of\s+age|old)\b", re.IGNORECASE),
    re.compile(r"\b(?:adults?|children|adolescents?|infants?|neonates?|elderly)\b", re.IGNORECASE),
]

_SAMPLE_SIZE_PATTERNS = [
    re.compile(r"\bn\s*=\s*\d{1,6}\b", re.IGNORECASE),
    re.compile(
        r"\b(?:enrolled|recruited|randomi[sz]ed|included|analy[sz]ed)\s+\d{1,6}\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b\d{1,6}\s+(?:participants?|patients?|subjects?|adults?|children|women|men)\b",
        re.IGNORECASE,
    ),
]

_DESIGN_TERMS = (
    "randomized controlled trial",
    "randomised controlled trial",
    "randomized trial",
    "randomised trial",
    "controlled trial",
    "clinical trial",
    "cohort study",
    "case-control",
    "cross-sectional",
    "longitudinal study",
    "pilot study",
    "feasibility study",
    "observational study",
    "systematic review",
    "scoping review",
    "narrative review",
    "literature review",
    "meta-analysis",
    "case report",
    "case series",
    "study protocol",
)

_NON_HUMAN_TERMS = (
    "in vitro",
    "in vivo",
    "mice",
    "mouse",
    "murine",
    "rats",
    "rat model",
    "rodent",
    "rabbits",
    "zebrafish",
    "animal model",
    "cell line",
    "cell culture",
)


def extract_hints(abstract: str, title: str = "") -> dict[str, Any]:
    """Pull candidate facts out of the paper's own words. Returns only what it found."""
    text = f"{title}\n{abstract}".strip()
    if not text:
        return {}

    hints: dict[str, Any] = {}

    ages = _collect(text, _AGE_PATTERNS)
    if ages:
        hints["age_or_population_mentions"] = ages

    sizes = _collect(text, _SAMPLE_SIZE_PATTERNS)
    if sizes:
        hints["sample_size_mentions"] = sizes

    designs = _find_terms(text, _DESIGN_TERMS)
    if designs:
        hints["study_design_mentions"] = designs

    non_human = _find_terms(text, _NON_HUMAN_TERMS)
    if non_human:
        hints["non_human_or_lab_mentions"] = non_human

    entities = _spacy_entities(text)
    if entities:
        hints["named_entities"] = entities

    return hints


def _collect(text: str, patterns: list[re.Pattern[str]], limit: int = 6) -> list[str]:
    """Return the matched spans themselves, so the model sees each phrase in context."""
    found: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in pattern.finditer(text):
            span = match.group(0).strip()
            if span.lower() not in seen:
                seen.add(span.lower())
                found.append(span)
            if len(found) >= limit:
                return found
    return found


def _find_terms(text: str, terms: tuple[str, ...]) -> list[str]:
    lowered = text.lower()
    return [term for term in terms if term in lowered]


def _spacy_entities(text: str, limit: int = 25) -> list[str]:
    nlp = _load_spacy()
    if nlp is None:
        return []
    doc = nlp(text[:5000])
    seen: list[str] = []
    for ent in doc.ents:
        label = f"{ent.text.strip()} ({ent.label_})"
        if label not in seen:
            seen.append(label)
        if len(seen) >= limit:
            break
    return seen


@lru_cache(maxsize=1)
def _load_spacy():
    """Load the spaCy pipeline once, or return None if spaCy is unavailable."""
    try:
        import spacy
    except ImportError:
        logger.info("spaCy not installed; Agent 4 is using regex evidence extraction only.")
        return None

    try:
        return spacy.load(SPACY_MODEL)
    except OSError:
        logger.warning(
            "spaCy is installed but the '%s' model is missing. Run: python -m spacy download %s",
            SPACY_MODEL,
            SPACY_MODEL,
        )
        return None
