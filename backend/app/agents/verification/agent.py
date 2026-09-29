"""Agent 4 - the Verification Agent.

An independent quality-assurance pass over Agent 3's draft screening decision.

Three design choices are worth knowing before reading the code:

*The LLM never sees Agent 3's decision.* Models anchor heavily on an answer they are
shown, so instructing one to "not trust" a decision in its own prompt does not buy
independence. The decision is withheld from the prompt entirely and compared here, in
ordinary Python, after the model has committed to its own judgement.

*Aggregation is not the model's job.* The LLM reports a status and a quoted span per
criterion. Turning those into INCLUDE/EXCLUDE is a deterministic fold below, so the
final label can always be traced to the specific check that produced it. The model's
own `decision` field is kept only as a cross-check; if it disagrees with the fold, that
is recorded as an issue rather than silently resolved.

*Confidence is derived, not asked for.* See _derive_confidence.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from app.agents.verification.nlp import extract_hints
from app.agents.verification.prompts import SYSTEM_PROMPT, build_user_prompt
from app.agents.verification.rules import run_metadata_rules
from app.core.config import settings
from app.core.sanitize import clean_model_text, sanitize_text
from app.schemas.screening import Decision
from app.schemas.verification import (
    CheckSource,
    CheckStatus,
    Confidence,
    CriterionCheck,
    VerificationResult,
    VerificationStatus,
    VerifyRequest,
)
from app.services.llm import complete_json, complete_json_routed

logger = logging.getLogger(__name__)

# Injected so tests can drive the agent with a stub instead of the network.
LLMCallable = Callable[..., Awaitable[dict[str, Any]]]


async def verify(request: VerifyRequest, *, llm: LLMCallable | None = None) -> VerificationResult:
    """Independently verify one paper against one protocol, then compare with Agent 3."""
    paper = request.paper
    protocol = request.protocol

    abstract, issues = sanitize_text(paper.abstract, max_chars=settings.max_abstract_chars)
    title, title_flags = sanitize_text(paper.title, max_chars=500)
    issues.extend(title_flags)
    sanitised_paper = paper.model_copy(update={"abstract": abstract, "title": title})

    if not abstract:
        issues.append("No abstract text was available, so every judgement rests on metadata alone.")

    # Deterministic first: these read metadata only, and can outrank the model.
    rule_checks, hard_exclude = run_metadata_rules(sanitised_paper, protocol)

    hints = extract_hints(abstract, title)
    user_prompt = build_user_prompt(sanitised_paper, protocol, abstract, hints)

    # A chain, not a model. The primary is named explicitly rather than inherited from
    # the generic default, and so is every fallback - Agent 3 must never appear anywhere
    # in it (see check_agent_models in app/core/config.py). The router tries them in
    # order, so a spent daily quota makes a paper slower instead of leaving it with one
    # opinion, which is the state this agent exists to prevent.
    chain = settings.verification_chain
    if llm is not None:
        # An injected client is a test double standing in for one model, so it is called
        # directly and named as the primary. Routing a stub would only exercise the
        # router; the router has its own tests.
        raw = await llm(
            system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt, model=chain[0]
        )
        model_used = chain[0]
    else:
        raw, model_used = await complete_json_routed(
            system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt, models=chain
        )
    # Which model answered is recorded on the result and in the audit trail, and stays
    # out of `issues`. `issues` is what the researcher sees under "Flagged during
    # verification", and it means problems with the PAPER - unsupported claims,
    # contradictions, text trying to give the model instructions. Which host answered a
    # request is a fact about this system's plumbing on one afternoon; putting it in the
    # same list tells someone screening papers to go and look at a paper that nothing is
    # wrong with, and buries the flags that do need them among routing notes.
    #
    # The independence cost of a same-family fallback is real, so it is not discarded -
    # it is carried as a confidence input below, where it lands on the sort order of the
    # researcher's queue instead of in their reading.
    weaker_independence = model_used is not None and settings.vendor_of(
        model_used
    ) == settings.vendor_of(settings.screening_model)

    canonical_names = [name for name, _ in protocol.inclusion_items()]
    canonical_names += [name for name, _ in protocol.exclusion_items()]
    llm_checks, llm_decision, llm_issues, llm_note = _parse_llm_output(raw, canonical_names)
    issues.extend(llm_issues)

    checks = _merge_checks(rule_checks, llm_checks)

    # The fold, not the model, produces the label.
    failed = [check for check in checks if check.status is CheckStatus.FAIL]
    unclear = [check for check in checks if check.status is CheckStatus.UNCLEAR]
    verified_decision = Decision.EXCLUDE if (failed or hard_exclude) else Decision.INCLUDE

    if llm_decision is not None and llm_decision is not verified_decision:
        issues.append(
            f"The model's own summary said {llm_decision.value}, but its per-criterion "
            f"findings imply {verified_decision.value}. The per-criterion findings were used."
        )

    confidence = _derive_confidence(
        unclear_count=len(unclear),
        hard_exclude=hard_exclude,
        has_abstract=bool(abstract),
        issue_count=len(issues),
        weaker_independence=weaker_independence,
    )

    agreement = verified_decision is request.screening_decision.decision
    return VerificationResult(
        pmid=paper.pmid,
        model=model_used,
        verified_decision=verified_decision,
        screening_decision=request.screening_decision.decision,
        agreement=agreement,
        verification_status=(
            VerificationStatus.VERIFIED if agreement else VerificationStatus.DISAGREEMENT
        ),
        confidence=confidence,
        checks=checks,
        issues=issues,
        verification_note=_build_note(
            agreement=agreement,
            verified_decision=verified_decision,
            failed=failed,
            unclear=unclear,
            llm_note=llm_note,
        ),
        # A disagreement or a shaky verification goes to the top of the researcher's
        # queue. Everything still requires their approval either way.
        needs_human_review=(not agreement) or confidence is Confidence.LOW,
    )


# Bounds on what the model may write into the review record. The prompt asks for an
# 8-word quote and a short issue list; anything far past that is a runaway or manipulated
# output, and it is shown to the researcher and stored, so it is cut rather than kept.
_MAX_EVIDENCE_CHARS = 300
_MAX_ISSUE_CHARS = 300
_MAX_ISSUES = 10
_MAX_NOTE_CHARS = 500


def _canonicalise(raw_name: str, canonical: list[str]) -> str:
    """Map a criterion name the model returned back onto the protocol's own name.

    Models embellish: asked for "population" they return "population: adults (18+)".
    Left alone that defeats _merge_checks, which grants a metadata rule precedence only
    over an LLM check carrying the *same* name - so a decorated name would smuggle an
    LLM reading past an authoritative rule. Exclusion names contain a colon of their
    own, so a prefix is only accepted when it still matches a known criterion.
    """
    candidate = raw_name.strip()
    lookup = {name.lower(): name for name in canonical}

    if candidate.lower() in lookup:
        return lookup[candidate.lower()]

    if ":" in candidate:
        parts = candidate.split(":")
        for cut in range(len(parts) - 1, 0, -1):
            prefix = ":".join(parts[:cut]).strip().lower()
            if prefix in lookup:
                return lookup[prefix]

    return candidate


def _iter_checks(raw_checks: Any) -> list[tuple[str, Any, str]]:
    """Yield (criterion, status, evidence) from either shape the model may return.

    The prompt asks for a compact map, {"population": ["PASS", "quote"]}, because the
    verbose array of objects repeated the keys "criterion", "status" and "evidence" for
    every criterion - and output tokens are this agent's binding rate limit, so those
    repeated keys were a direct cost in wall-clock time per paper.

    The older array form is still accepted. A model that ignores the format instruction
    should produce a slower verification, not a failed one.
    """
    entries: list[tuple[str, Any, str]] = []

    if isinstance(raw_checks, dict):
        for name, value in raw_checks.items():
            if isinstance(value, (list, tuple)):
                status = value[0] if len(value) > 0 else "UNCLEAR"
                evidence = value[1] if len(value) > 1 else ""
            elif isinstance(value, dict):
                status = value.get("status", "UNCLEAR")
                evidence = value.get("evidence", "")
            else:
                # {"population": "PASS"} - a status with no evidence offered.
                status, evidence = value, ""
            entries.append((str(name), status, clean_model_text(evidence, max_chars=_MAX_EVIDENCE_CHARS)))
        return entries

    if not isinstance(raw_checks, (list, tuple)):
        # A number, a string, None - the model answered with something that is not a
        # set of checks at all. That is an unanswered paper, not a crashed pass.
        return entries

    for entry in raw_checks:
        if not isinstance(entry, dict):
            continue
        entries.append(
            (
                str(entry.get("criterion", "")),
                entry.get("status", "UNCLEAR"),
                clean_model_text(entry.get("evidence"), max_chars=_MAX_EVIDENCE_CHARS),
            )
        )
    return entries


def _parse_llm_output(
    raw: dict[str, Any],
    canonical_names: list[str],
) -> tuple[list[CriterionCheck], Decision | None, list[str], str]:
    """Read the model's JSON defensively - a malformed field must not crash the pass."""
    checks: list[CriterionCheck] = []
    seen: set[str] = set()
    downgraded: list[str] = []
    known = {name.lower() for name in canonical_names}
    invented: list[str] = []
    for raw_name, status, evidence in _iter_checks(raw.get("checks")):
        criterion = _canonicalise(raw_name, canonical_names)
        if not criterion or criterion.lower() in seen:
            continue
        if known and criterion.lower() not in known:
            # A criterion the protocol does not contain has no standing: judged FAIL it
            # would exclude the paper on a rule nobody set. Text in an abstract can talk a
            # model into inventing one, so it is reported rather than applied.
            invented.append(clean_model_text(criterion, max_chars=80))
            continue
        seen.add(criterion.lower())
        try:
            check = CriterionCheck(
                criterion=criterion,
                status=status,
                evidence=evidence,
                source=CheckSource.LLM,
            )
        except ValueError:
            # An unrecognised status means the model did not really judge this
            # criterion; treat it as unanswered rather than guessing which way it went.
            check = CriterionCheck(
                criterion=criterion,
                status=CheckStatus.UNCLEAR,
                evidence="",
                source=CheckSource.LLM,
            )

        # A FAIL with nothing quoted behind it is not a finding, and it is the only
        # status that on its own turns the fold below into EXCLUDE - so left alone it
        # discards the paper on the model's unsupported say-so, which is the exact thing
        # the evidence requirement exists to prevent. Measured, not hypothetical: asked
        # about an abstract that simply never mentions the intervention, the model
        # answers ["FAIL", ""] rather than ["UNCLEAR", ""], on the long prompt as well as
        # the short one. The prompt asks for a quote; this is what makes it true.
        #
        # Only FAIL. PASS and UNCLEAR cannot exclude a paper by themselves, so an
        # unevidenced one is weak rather than dangerous, and downgrading those too would
        # push ordinary papers to LOW confidence and flood the researcher's queue.
        if check.status is CheckStatus.FAIL and not check.evidence.strip():
            downgraded.append(check.criterion)
            check = CriterionCheck(
                criterion=check.criterion,
                status=CheckStatus.UNCLEAR,
                evidence="",
                source=CheckSource.LLM,
            )

        checks.append(check)

    decision: Decision | None = None
    raw_decision = str(raw.get("decision", "")).strip().upper()
    if raw_decision in Decision.__members__:
        decision = Decision[raw_decision]

    # Model output is untrusted too: an injected abstract can steer what the model writes
    # here, and this list is shown to the researcher verbatim. A bare string is accepted
    # as one issue rather than iterated character by character.
    raw_issues = raw.get("issues") or []
    if isinstance(raw_issues, str):
        raw_issues = [raw_issues]
    elif not isinstance(raw_issues, (list, tuple)):
        raw_issues = []
    issues = [
        clean_model_text(item, max_chars=_MAX_ISSUE_CHARS)
        for item in list(raw_issues)[:_MAX_ISSUES]
        if str(item or "").strip()
    ]
    if downgraded:
        # Surfaced rather than silently corrected: the researcher is being told the model
        # wanted to reject this paper and could not say why, which is worth reading.
        issues.append(
            "The model marked "
            + ", ".join(downgraded)
            + " as failed but quoted nothing from the paper to support it, so "
            + ("they were" if len(downgraded) > 1 else "it was")
            + " recorded as unclear instead of excluding the paper."
        )
    if invented:
        issues.append(
            "The model reported criteria that are not in the protocol ("
            + ", ".join(invented[:5])
            + "); they were ignored and did not affect the decision."
        )
    note = clean_model_text(raw.get("note"), max_chars=_MAX_NOTE_CHARS)
    return checks, decision, issues, note


def _merge_checks(
    rule_checks: list[CriterionCheck], llm_checks: list[CriterionCheck]
) -> list[CriterionCheck]:
    """Rules win where both spoke: metadata beats a reading of the prose."""
    merged = list(rule_checks)
    claimed = {check.criterion.lower() for check in rule_checks}
    merged.extend(check for check in llm_checks if check.criterion.lower() not in claimed)
    return merged


def _derive_confidence(
    *,
    unclear_count: int,
    hard_exclude: bool,
    has_abstract: bool,
    issue_count: int,
    weaker_independence: bool = False,
) -> Confidence:
    """Compute confidence from what the checks actually established.

    Asking an LLM for its confidence returns a near-constant HIGH, which tells a
    researcher nothing. This instead counts the criteria that could not be settled
    against the source text.

    `weaker_independence` is the one input that is not about the paper: it is true when
    the model that answered shares a training lineage with the screening agent, which
    happens when the fallback chain runs far enough down. Their agreement is then weaker
    evidence of independent confirmation, and confidence is what carries that - it sorts
    the researcher's queue without putting a note about model routing in front of someone
    reading a study.
    """
    # A metadata rule failure is arithmetic on structured fields - nothing about the
    # abstract can make it less certain, including which model was asked.
    if hard_exclude:
        return Confidence.HIGH
    if not has_abstract or unclear_count >= 2:
        return Confidence.LOW
    if unclear_count == 1 or issue_count or weaker_independence:
        return Confidence.MEDIUM
    return Confidence.HIGH


def _build_note(
    *,
    agreement: bool,
    verified_decision: Decision,
    failed: list[CriterionCheck],
    unclear: list[CriterionCheck],
    llm_note: str,
) -> str:
    parts: list[str] = []
    if failed:
        names = ", ".join(check.criterion for check in failed)
        parts.append(f"{verified_decision.value}: failed on {names}.")
    else:
        parts.append("All protocol criteria were confirmed against the paper text.")

    if unclear:
        names = ", ".join(check.criterion for check in unclear)
        parts.append(f"The paper text does not state: {names}.")

    if not agreement:
        parts.append(
            f"This disagrees with the screening decision, so verification returned "
            f"{verified_decision.value} for the researcher to confirm."
        )

    if llm_note:
        parts.append(llm_note)

    return " ".join(parts)
