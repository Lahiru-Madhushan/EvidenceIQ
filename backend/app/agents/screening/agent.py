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
from app.core.sanitize import sanitize_text
from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import Decision, ScreeningDecision
from app.services.llm import complete_json

logger = logging.getLogger(__name__)

LLMCallable = Callable[..., Awaitable[dict[str, Any]]]

# Deliberately different from Agent 4's verification model (see app/core/config.py) -
# two agents sharing one model would share its blind spots.
SCREENING_MODEL = "openai/gpt-oss-20b"


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

    if not abstract:
        # No abstract means no real basis to include - default to EXCLUDE and say why,
        # rather than guessing. A human can still override this in the review screen.
        return ScreeningDecision(
            pmid=paper.pmid,
            decision=Decision.EXCLUDE,
            reason="No abstract text was available to screen against the protocol.",
        )

    user_prompt = build_user_prompt(sanitised_paper, protocol, abstract)

    raw = await llm(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        model=SCREENING_MODEL,
    )

    return _parse_llm_output(raw, pmid=paper.pmid)


def _parse_llm_output(raw: dict[str, Any], *, pmid: str) -> ScreeningDecision:
    """Read the model's JSON defensively - a malformed field must not crash the agent."""
    raw_decision = str(raw.get("decision", "")).strip().upper()
    reason = str(raw.get("reason") or "").strip()

    if raw_decision not in Decision.__members__:
        logger.warning("Screening Agent got an unrecognised decision: %r", raw_decision)
        return ScreeningDecision(
            pmid=pmid,
            decision=Decision.EXCLUDE,
            reason=reason or f"Could not parse a valid decision from the model output: {raw!r}",
        )

    return ScreeningDecision(
        pmid=pmid,
        decision=Decision[raw_decision],
        reason=reason or "No reason provided by the model.",
    )