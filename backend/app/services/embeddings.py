"""Text embeddings from Gemini, for Quick Chat's semantic search.

Kept apart from llm.py on purpose. That module paces and retries chat completions
because a screening run has no other way to finish; an embedding here is always an
optional improvement on a ranking that already works without it, so the right response
to any failure - a quota, a timeout, a missing key - is to give up at once and let the
caller fall back, not to keep a researcher waiting for a better answer to the same
question.
"""

from __future__ import annotations

import logging
from typing import Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# The API refuses more than this many texts in one batchEmbedContents call.
MAX_BATCH = 100

# Gemini embeds a passage and a question differently when told which is which, so that
# the two land near each other when one answers the other.
Task = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


class EmbeddingUnavailable(Exception):
    """No embedding could be had. Callers fall back to lexical ranking."""


def enabled() -> bool:
    return bool(settings.embedding_model and settings.gemini_api_key)


def embedder_id() -> str:
    """What produced a vector. Vectors from different embedders must not be compared."""
    return f"{settings.embedding_model}@{settings.embedding_dimensions}"


async def embed(texts: list[str], task: Task) -> list[list[float]]:
    """One vector per text, in order, or EmbeddingUnavailable."""
    if not enabled():
        raise EmbeddingUnavailable("Embeddings are not configured.")
    if not texts:
        return []

    model = f"models/{settings.embedding_model}"
    url = f"{settings.embedding_base_url}/{model}:batchEmbedContents"
    # A header, not the documented ?key= parameter: a query string ends up in access
    # logs and exception messages, and this key is the same one Agent 4 falls back on.
    headers = {"x-goog-api-key": settings.gemini_api_key}

    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=settings.embedding_timeout_seconds) as client:
        for start in range(0, len(texts), MAX_BATCH):
            batch = texts[start : start + MAX_BATCH]
            body = {
                "requests": [
                    {
                        "model": model,
                        "content": {"parts": [{"text": text}]},
                        "taskType": task,
                        "outputDimensionality": settings.embedding_dimensions,
                    }
                    for text in batch
                ]
            }
            try:
                response = await client.post(url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                raise EmbeddingUnavailable(f"Embedding request failed: {type(exc).__name__}") from exc

            if response.status_code != 200:
                # Status only: the body can quote the request, which is the user's document.
                logger.warning("Embedding refused: HTTP %d", response.status_code)
                raise EmbeddingUnavailable(f"Embedding refused with HTTP {response.status_code}")

            try:
                got = [item["values"] for item in response.json()["embeddings"]]
            except (ValueError, KeyError, TypeError) as exc:
                raise EmbeddingUnavailable("Embedding response was not understood") from exc
            if len(got) != len(batch):
                raise EmbeddingUnavailable("Embedding response had the wrong number of vectors")
            vectors.extend(got)

    return vectors
