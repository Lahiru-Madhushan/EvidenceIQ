"""Deterministic pre-checks for Agent 4.

The split is deliberate: rules only ever read *structured metadata* returned by PubMed
(publication year, publication types). Anything requiring the abstract's prose to be
read is left to the LLM.

That is what lets a rule be authoritative. A 2009 paper falls outside a 2015-2026
window as a matter of arithmetic, not judgement, so that result can override the model.
Nothing inferred from wording gets the same standing - "we excluded patients with type 1
diabetes" is a sentence that appears in perfectly good type 2 diabetes papers, and a
regex that treats it as a match would throw them all away.
"""

from __future__ import annotations

import re

from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.verification import CheckSource, CheckStatus, CriterionCheck

# PubMed <PublicationType> values meaning "not an original study".
_NON_ORIGINAL_TYPES = re.compile(
    r"^(?:review|systematic review|meta-analysis|scoping review|narrative review|"
    r"editorial|comment|letter|published erratum)$",
    re.IGNORECASE,
)


def run_metadata_rules(paper: Paper, protocol: Protocol) -> tuple[list[CriterionCheck], bool]:
    """Return (checks, hard_exclude).

    hard_exclude is True only when a rule failed on metadata the protocol treats as
    disqualifying. The caller lets that outrank whatever the LLM concluded.
    """
    checks: list[CriterionCheck] = []
    hard_exclude = False

    if protocol.date_range is not None:
        year_check = _check_year(paper, protocol)
        checks.append(year_check)
        if year_check.status is CheckStatus.FAIL:
            hard_exclude = True

    if protocol.excludes_review_articles() and paper.publication_types:
        type_check = _check_publication_type(paper)
        checks.append(type_check)
        if type_check.status is CheckStatus.FAIL:
            hard_exclude = True

    return checks, hard_exclude


def _check_year(paper: Paper, protocol: Protocol) -> CriterionCheck:
    date_range = protocol.date_range
    if date_range is None:  # pragma: no cover - guarded by the caller
        raise ValueError("_check_year requires a protocol with a date_range")

    if paper.year is None:
        return CriterionCheck(
            criterion="publication_date",
            status=CheckStatus.UNCLEAR,
            evidence="",
            source=CheckSource.RULE,
        )

    inside = date_range.contains(paper.year)
    return CriterionCheck(
        criterion="publication_date",
        status=CheckStatus.PASS if inside else CheckStatus.FAIL,
        evidence=(
            f"Published {paper.year}, within {date_range}."
            if inside
            else f"Published {paper.year}; the protocol requires {date_range}."
        ),
        source=CheckSource.RULE,
    )


def _check_publication_type(paper: Paper) -> CriterionCheck:
    offending = [
        ptype for ptype in paper.publication_types if _NON_ORIGINAL_TYPES.match(ptype.strip())
    ]
    if offending:
        return CriterionCheck(
            criterion="study_type",
            status=CheckStatus.FAIL,
            evidence=(
                f"PubMed publication type: {', '.join(offending)}. "
                "The protocol excludes review articles."
            ),
            source=CheckSource.RULE,
        )
    return CriterionCheck(
        criterion="study_type",
        status=CheckStatus.PASS,
        evidence=f"PubMed publication type: {', '.join(paper.publication_types)}.",
        source=CheckSource.RULE,
    )
