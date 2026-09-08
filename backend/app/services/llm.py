"""LLM client used by the Verification Agent.

Groq exposes the OpenAI chat-completions API, so this stays provider-agnostic: point
LLM_BASE_URL elsewhere and everything below still works. Other agents are free to reuse
it, but nothing here is specific to verification.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Transient upstream conditions worth another attempt; anything else fails fast.
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    """The model could not be reached, or did not return usable JSON."""


async def complete_json(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int = 2000,
) -> dict[str, Any]:
    """Call the chat model in JSON mode and return the parsed object.

    Temperature defaults to 0: two verification runs over the same paper should not
    disagree with each other, or the verification layer is just noise.
    """
    if not settings.llm_api_key:
        raise LLMError("LLM_API_KEY is not set - the Verification Agent cannot run.")

    payload = {
        "model": model or settings.llm_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"

    last_error = "unknown error"
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        for attempt in range(settings.llm_max_retries + 1):
            try:
                response = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"request failed: {exc}"
            else:
                if response.status_code == 200:
                    return _parse_choice(response.json())
                # The body carries the provider's reason (unknown model, quota, ...).
                # Keep it for the error message; never log the Authorization header.
                last_error = f"HTTP {response.status_code}: {response.text[:400]}"
                if response.status_code not in _RETRYABLE_STATUS:
                    break

            if attempt < settings.llm_max_retries:
                backoff = 2**attempt
                logger.warning("LLM call failed (%s); retrying in %ss", last_error, backoff)
                await asyncio.sleep(backoff)

    raise LLMError(
        f"LLM call failed after {settings.llm_max_retries + 1} attempt(s). {last_error}"
    )


def _parse_choice(body: dict[str, Any]) -> dict[str, Any]:
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected response shape from the LLM: {str(body)[:300]}") from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMError(f"LLM did not return valid JSON: {content[:300]}") from exc

    if not isinstance(parsed, dict):
        raise LLMError(f"LLM returned {type(parsed).__name__}, expected a JSON object.")
    return parsed
