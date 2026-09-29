"""Agent 3 - the Screening Agent.

Reads a paper and the review's protocol, and produces a first-pass INCLUDE/EXCLUDE
decision with a reason. This is a DRAFT decision - Agent 4 (Verification) independently
re-checks it afterwards, so this agent does not need to be perfect, only honest about
its own uncertainty.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from app.agents.screening.prompts import SYSTEM_PROMPT, build_user_prompt
from app.core.config import settings
from app.core.sanitize import clean_model_text, sanitize_text
from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.services.llm import complete_json

logger = logging.getLogger(__name__)

LLMCallable = Callable[..., Awaitable[dict[str, Any]]]

# Deliberately different from Agent 4's verification model (see app/core/config.py) -
# two agents sharing one model would share its blind spots. Configurable so the pair can
# be changed together, but check_agent_models() refuses to start if they ever match.
SCREENING_MODEL = settings.screening_model


async def screen(
    paper: Paper,
    protocol: Protocol,
    *,
    llm: LLMCallable | None = None,
) -> ScreeningDecision:
    """Produce a draft Include/Exclude decision for one paper against one protocol."""
    llm = llm or complete_json

    abstract, issues = sanitize_text(paper.abstract, max_chars=settings.max_abstract_chars)
    title, title_flags = sanitize_text(paper.title, max_chars=500)
    issues.extend(title_flags)
    sanitised_paper = paper.model_copy(update={"abstract": abstract, "title": title})

    if not abstract or abstract.strip().lower().rstrip(".") == "abstract not available":
        # No abstract means no real basis to include, so the draft stays EXCLUDE - but it
        # is marked for a person rather than presented as a judgement. PubMed records
        # without abstracts skew towards older papers and smaller journals, so silently
        # excluding them would bias the review against exactly that evidence.
        issues.append(
            "No abstract was available, so this paper was not assessed by the model. "
            "Check the full text before relying on this decision."
        )
        return ScreeningDecision(
            pmid=paper.pmid,
            decision=Decision.EXCLUDE,
            reason="No abstract text was available to screen against the protocol.",
            flags=issues,
            needs_human_review=True,
        )

    user_prompt = build_user_prompt(sanitised_paper, protocol, abstract)

    raw = await llm(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        model=SCREENING_MODEL,
    )

    decision = _parse_llm_output(raw, pmid=paper.pmid)
    return decision.model_copy(
        update={
            "flags": issues + decision.flags,
            "needs_human_review": decision.needs_human_review or bool(issues),
            "model": SCREENING_MODEL,
        }
    )


# A reason is one sentence for a researcher to read. Anything longer is a runaway or a
# manipulated output, and either way it does not belong in the review record.
_MAX_REASON_CHARS = 500


def _parse_llm_output(raw: dict[str, Any], *, pmid: str) -> ScreeningDecision:
    """Read the model's JSON defensively - a malformed field must not crash the agent."""
    raw_decision = str(raw.get("decision", "")).strip().upper()
    reason = clean_model_text(raw.get("reason"), max_chars=_MAX_REASON_CHARS)

    if raw_decision not in Decision.__members__:
        logger.warning("Screening Agent got an unrecognised decision (%d chars)", len(raw_decision))
        # The raw output is not echoed into the reason: it is untrusted model text, and
        # it would put whatever the model produced straight onto the researcher's screen.
        return ScreeningDecision(
            pmid=pmid,
            decision=Decision.EXCLUDE,
            reason=reason or "Could not parse a valid decision from the model output.",
            flags=["The screening model returned no valid decision; defaulted to EXCLUDE."],
            needs_human_review=True,
        )

    return ScreeningDecision(
        pmid=pmid,
        decision=Decision[raw_decision],
        reason=reason or "No reason provided by the model.",
    )