import json
import logging
import re
import time

import httpx

from app.core.config import settings
from app.services.llm import retry_after_seconds

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"

# Same policy as app/services/llm.py, which Agents 3 and 4 use.
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_MAX_RETRIES = 2
_MAX_BACKOFF_SECONDS = 30.0


class CriteriaAgentError(RuntimeError):
    """The Criteria Agent could not reach the model, or got back something unusable."""

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


def interpret_criteria(research_question: str, raw_criteria: str, clarification_context: str = "") -> dict:
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

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }

    raw_content = _call_groq(payload, headers)

    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        raise CriteriaAgentError(
            f"The Criteria Agent did not return valid JSON: {raw_content[:200]}"
        ) from exc

    if not isinstance(parsed, dict):
        raise CriteriaAgentError(
            f"The Criteria Agent returned {type(parsed).__name__}, expected a JSON object."
        )
    return parsed


def _call_groq(payload: dict, headers: dict) -> str:
    """POST to Groq, retrying transient failures, and return the message content.

    This mirrors the retry policy in app/services/llm.py rather than sharing it, because
    that client is async and this agent runs synchronously. The behaviour that matters
    is the same: retry what is worth retrying, wait as long as the provider asks, and
    raise one typed error instead of letting a network exception escape as a 500.
    """
    if not settings.llm_api_key:
        raise CriteriaAgentError("LLM_API_KEY is not set - the Criteria Agent cannot run.")

    last_error = "unknown error"
    for attempt in range(_MAX_RETRIES + 1):
        requested_wait = None
        try:
            response = httpx.post(GROQ_API_URL, headers=headers, json=payload, timeout=30)
        except httpx.HTTPError as exc:
            last_error = f"request failed: {exc}"
        else:
            if response.status_code == 200:
                try:
                    return response.json()["choices"][0]["message"]["content"]
                except (KeyError, IndexError, TypeError, ValueError) as exc:
                    raise CriteriaAgentError(
                        f"Unexpected response shape from the model: {response.text[:200]}"
                    ) from exc
            # Never log or echo the Authorization header; the body is safe to keep.
            last_error = f"HTTP {response.status_code}: {response.text[:300]}"
            if response.status_code not in _RETRYABLE_STATUS:
                break
            requested_wait = retry_after_seconds(response)

        if attempt < _MAX_RETRIES:
            backoff = min(max(2**attempt, requested_wait or 0.0), _MAX_BACKOFF_SECONDS)
            logger.warning("Criteria Agent call failed (%s); retrying in %ss", last_error, backoff)
            time.sleep(backoff)

    raise CriteriaAgentError(
        f"The Criteria Agent could not reach the model after {_MAX_RETRIES + 1} attempt(s). "
        f"{last_error}"
    )