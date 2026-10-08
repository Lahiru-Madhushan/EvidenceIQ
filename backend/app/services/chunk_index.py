"""Quick Chat's semantic index: a document's passages as vectors, in pgvector.

Only documents too long to send whole are indexed - a short one goes to the model in
full and has nothing to rank. The index is built when a chat is created and, failing
that, on the first question that needs it, which is also how chats from before this
existed acquire one.

Everything here is best effort. The lexical ranking in document_text answers without
it, so every failure - no key, a spent quota, the migration not yet applied, a database
that is not Postgres - ends in a log line and `None`, never in an error the researcher
sees.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.chat import ChatSession
from app.services import embeddings
from app.services.document_text import CONTEXT_BUDGET_CHARS, chunk

logger = logging.getLogger(__name__)

# How many passages the vector search proposes. The context budget holds about ten, so
# thirty leaves the fusion with real choices without ranking the whole document.
CANDIDATES = 30


def needs_retrieval(document_text: str) -> bool:
    return len((document_text or "").strip()) > CONTEXT_BUDGET_CHARS


def _usable(db: Session) -> bool:
    if not embeddings.enabled():
        return False
    try:
        return db.get_bind().dialect.name == "postgresql"
    except Exception:
        return False


def _vector(values: list[float]) -> str:
    """pgvector's text form, so no driver adapter is needed: "[0.1,0.2,...]"."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


async def ensure_index(db: Session, row: ChatSession) -> bool:
    """Make sure `row`'s passages are embedded under the current settings.

    True when an up-to-date index exists afterwards. Built from chunk(), the same split
    select_context ranks, so a stored ordinal always names the passage it was made from.
    """
    if not needs_retrieval(row.document_text) or not _usable(db):
        return False

    passages = chunk(row.document_text)
    embedder = embeddings.embedder_id()
    try:
        count, embedders = db.execute(
            text(
                "select count(*), count(distinct embedder) filter (where embedder <> :e) "
                "from chat_chunks where session_id = :s"
            ),
            {"s": row.id, "e": embedder},
        ).one()
        # Ends the read's transaction before the network call below, so a pooled
        # connection is not held open while Gemini answers.
        db.rollback()
        if count == len(passages) and embedders == 0:
            return True

        vectors = await embeddings.embed(passages, "RETRIEVAL_DOCUMENT")

        db.execute(text("delete from chat_chunks where session_id = :s"), {"s": row.id})
        db.execute(
            text(
                "insert into chat_chunks (session_id, ordinal, content, embedder, embedding) "
                "values (:s, :o, :c, :e, cast(:v as extensions.vector))"
            ),
            [
                {"s": row.id, "o": i, "c": passage, "e": embedder, "v": _vector(vector)}
                for i, (passage, vector) in enumerate(zip(passages, vectors))
            ],
        )
        db.commit()
        logger.info("Indexed %d passages for a chat", len(passages))
        return True
    except embeddings.EmbeddingUnavailable as exc:
        logger.info("Chat not indexed, lexical ranking only: %s", exc)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.warning("Chat not indexed, lexical ranking only: %s", type(exc).__name__)
    return False


async def semantic_order(db: Session, row: ChatSession, question: str) -> list[int] | None:
    """Passage indexes ranked by meaning against `question`, best first, or None."""
    if not await ensure_index(db, row):
        return None
    try:
        [query] = await embeddings.embed([question], "RETRIEVAL_QUERY")
        rows = db.execute(
            text(
                "select ordinal from chat_chunks where session_id = :s "
                "order by embedding operator(extensions.<=>) cast(:q as extensions.vector) "
                "limit :k"
            ),
            {"s": row.id, "q": _vector(query), "k": CANDIDATES},
        ).all()
        db.rollback()
        return [ordinal for (ordinal,) in rows]
    except embeddings.EmbeddingUnavailable as exc:
        logger.info("Question not embedded, lexical ranking only: %s", exc)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.warning("Semantic search failed, lexical ranking only: %s", type(exc).__name__)
    return None
