"""Quick Chat's semantic search: fused with the lexical ranking, and never required.

Two promises. When embeddings are available, a passage that answers the question in
different words than it was asked can still reach the model. When they are not - no key,
a spent quota, a database without the table - the chat answers exactly as it did before
they existed.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import httpx
import pytest

from app.core.config import settings
from app.models.chat import ChatSession
from app.services import chunk_index, embeddings
from app.services.document_text import (
    CONTEXT_BUDGET_CHARS,
    _interleave,
    _lexical_order,
    chunk,
    normalise,
    select_context,
)


def synonym_paper() -> str:
    """A paper whose answer to "heart attacks?" never uses either word."""
    filler = lambda topic, n: " ".join(f"{topic} sentence {i} of background." for i in range(n))
    return normalise(
        "\n\n".join(
            [
                "Abstract. A cohort study of statin use in older adults.",
                # Plenty of "heart" for term overlap to find - none of it the answer.
                "Background. " + filler("Heart failure and heart rhythm", 300),
                "Methods. " + filler("Recruitment", 300),
                "Outcomes. Myocardial infarction occurred in 31 participants.",
                "Discussion. " + filler("Comparison", 400),
            ]
        )
    )


def _index_of(passages: list[str], needle: str) -> int:
    return next(i for i, passage in enumerate(passages) if needle in passage)


# --- combining the rankings ---------------------------------------------------------


def test_rankings_alternate_without_repeats():
    assert _interleave([1, 2, 3], [2, 9]) == [1, 2, 9, 3]


def test_a_passage_only_one_ranking_found_is_kept():
    assert 9 in _interleave([1, 2], [9])


def test_a_synonym_passage_lexical_search_misses_reaches_the_model_with_semantics():
    paper = synonym_paper()
    assert len(paper) > CONTEXT_BUDGET_CHARS
    passages = chunk(paper)
    answer = _index_of(passages, "Myocardial infarction")
    question = "How many heart attacks were there?"

    lexical_only = select_context(paper, question)
    assert "Myocardial infarction occurred" not in lexical_only

    # As measured against Gemini: the answer ranks first by meaning, followed by every
    # page of "heart" background, which the lexical ranking also likes. Reciprocal rank
    # fusion let those pages crowd the answer out of the budget.
    heart_pages = _lexical_order(passages, question)
    with_meaning = select_context(paper, question, semantic_order=[answer, *heart_pages])
    assert "Myocardial infarction occurred in 31 participants" in with_meaning


def test_the_best_lexical_match_still_travels_with_semantics():
    paper = synonym_paper()
    passages = chunk(paper)
    statin = _index_of(passages, "statin")
    unrelated = [i for i in range(len(passages)) if i != statin]
    assert "statin use" in select_context(paper, "statin", semantic_order=unrelated)


def test_out_of_range_semantic_indexes_are_ignored():
    paper = synonym_paper()
    assert select_context(paper, "statin", semantic_order=[10_000, -1]) == select_context(
        paper, "statin"
    )


def test_a_short_document_is_still_sent_whole():
    short = "We enrolled 480 participants."
    assert select_context(short, "how many?", semantic_order=[0]) == short


# --- the embedding client -------------------------------------------------------------


@pytest.fixture
def gemini(monkeypatch):
    """Route the embedding client to a fake Gemini, recording what it was sent."""
    calls: list[dict] = []

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append({"headers": request.headers, "url": str(request.url), "body": body})
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [float(len(calls)), 0.0]} for _ in body["requests"]]},
        )

    transport = httpx.MockTransport(respond)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        embeddings.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw)
    )
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "embedding_model", "gemini-embedding-001")
    return calls


def test_texts_are_embedded_in_batches_the_api_accepts(gemini):
    vectors = asyncio.run(embeddings.embed([f"p{i}" for i in range(250)], "RETRIEVAL_DOCUMENT"))
    assert len(vectors) == 250
    assert [len(call["body"]["requests"]) for call in gemini] == [100, 100, 50]


def test_the_key_travels_in_a_header_never_the_url(gemini):
    asyncio.run(embeddings.embed(["text"], "RETRIEVAL_QUERY"))
    assert gemini[0]["headers"]["x-goog-api-key"] == "test-key"
    assert "test-key" not in gemini[0]["url"]
    request = gemini[0]["body"]["requests"][0]
    assert request["taskType"] == "RETRIEVAL_QUERY"
    assert request["outputDimensionality"] == settings.embedding_dimensions


def test_a_refusal_is_reported_as_unavailable(monkeypatch):
    transport = httpx.MockTransport(lambda request: httpx.Response(429, text="quota"))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        embeddings.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw)
    )
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    with pytest.raises(embeddings.EmbeddingUnavailable):
        asyncio.run(embeddings.embed(["text"], "RETRIEVAL_QUERY"))


def test_no_key_means_no_call(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    assert not embeddings.enabled()
    with pytest.raises(embeddings.EmbeddingUnavailable):
        asyncio.run(embeddings.embed(["text"], "RETRIEVAL_QUERY"))


# --- the index degrades to lexical ranking --------------------------------------------


class _SqliteDb:
    """Enough of a Session to report a database that is not Postgres."""

    class _Bind:
        class dialect:
            name = "sqlite"

    def get_bind(self):
        return self._Bind()

    def execute(self, *args, **kwargs):  # pragma: no cover - must never be reached
        raise AssertionError("the index must not query a database without pgvector")


def _chat(text: str) -> ChatSession:
    return ChatSession(id=uuid.uuid4(), document_text=text)


def test_no_semantic_ranking_without_postgres(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    order = asyncio.run(chunk_index.semantic_order(_SqliteDb(), _chat(synonym_paper()), "q"))
    assert order is None


def test_a_short_document_is_never_indexed(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    assert asyncio.run(chunk_index.ensure_index(_SqliteDb(), _chat("short"))) is False


def test_vectors_are_written_in_pgvector_text_form():
    assert chunk_index._vector([0.5, -1, 2.25]) == "[0.5,-1.0,2.25]"
