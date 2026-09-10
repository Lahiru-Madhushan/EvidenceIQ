import json
import re
import httpx

from app.core.config import settings

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"

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

    response = httpx.post(GROQ_API_URL, headers=headers, json=payload, timeout=30)
    response.raise_for_status()

    raw_content = response.json()["choices"][0]["message"]["content"]
    return json.loads(raw_content)