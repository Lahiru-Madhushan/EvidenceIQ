import logging
import re

from app.core.config import settings
from app.services.llm import LLMError, LLMQuotaExhausted, complete_json

logger = logging.getLogger(__name__)


class CriteriaAgentError(RuntimeError):
    """The Criteria Agent could not reach the model, or got back something unusable."""


class CriteriaQuotaExhausted(CriteriaAgentError):
    """The token budget is spent. Carries the wait so the router can report it."""

    def __init__(self, message: str, *, wait_seconds: float) -> None:
        self.wait_seconds = wait_seconds
        super().__init__(message)

SYSTEM_PROMPT = """You are the Criteria Agent in a systematic review screening system.

Your job is to convert a researcher's plain-language inclusion/exclusion criteria
into an exact, unambiguous screening protocol.

Rules:
1. If any term is ambiguous (could reasonably mean more than one thing — e.g. "diabetes"
   without specifying type 1 or type 2), do NOT guess. Set status to "clarification_needed".
2. If two criteria conflict with each other, treat that as ambiguous too.
3. If everything is clear, set status to "ready" and produce the full protocol.
4. Respond with STRICT JSON ONLY. No prose, no markdown, no explanation outside the JSON.

Output format (clarification needed):
{"status": "clarification_needed", "ambiguous_term": "...", "question": "..."}

Output format (ready):
{
  "status": "ready",
  "protocol": {
    "population": "...",
    "condition": "...",
    "intervention": "...",
    "date_range": {"from": 2015, "to": 2026},
    "excludes": ["...", "..."],
    "additional_criteria": []
  }
}
"""


def sanitize_input(text: str) -> str:
    """
    Strips control characters and excessive whitespace from user-supplied text
    before it reaches the LLM. Keeps system instructions and user data separate
    (defense against prompt injection).
    """
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


async def interpret_criteria(
    research_question: str, raw_criteria: str, clarification_context: str = ""
) -> dict:
    """
    Calls Groq to interpret the researcher's criteria.
    Returns a dict with either:
      {"status": "clarification_needed", "ambiguous_term": ..., "question": ...}
    or
      {"status": "ready", "protocol": {...}}
    """
    research_question = sanitize_input(research_question)
    raw_criteria = sanitize_input(raw_criteria)
    if clarification_context:
        clarification_context = sanitize_input(clarification_context)

    user_message = f"Research question: {research_question}\nCriteria: {raw_criteria}"
    if clarification_context:
        user_message += f"\n\nPrevious clarification exchange:\n{clarification_context}"

    try:
        return await complete_json(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_message,
            model=settings.criteria_model,
        )
    except LLMQuotaExhausted as exc:
        raise CriteriaQuotaExhausted(str(exc), wait_seconds=exc.wait_seconds) from exc
    except LLMError as exc:
        raise CriteriaAgentError(str(exc)) from exc
