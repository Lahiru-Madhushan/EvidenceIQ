"""Quick Chat: upload a document, ask questions about it, keep the thread.

Everything here is scoped to the signed-in researcher by an explicit owner check. The
tables carry RLS policies as well, but this connection is not the user's - the backend
holds one pooled connection - so the check in _own_session is the one actually doing the
work, exactly as in the pipeline router.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.chat import ChatMessage, ChatSession
from app.schemas.quick_chat import (
    AskRequest,
    AskResponse,
    ChatMessageOut,
    ChatSessionDetail,
    ChatSessionSummary,
)
from app.services.document_text import MAX_DOCUMENT_CHARS, DocumentError, extract_text
from app.services.llm import LLMError, LLMQuotaExhausted
from app.services.quick_chat import MAX_HISTORY_TURNS, answer_from_document, title_for

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quick-chat", tags=["quick-chat"])

# Generous for a paper, small enough that a stray upload cannot exhaust memory.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _own_session(db: Session, session_id: uuid.UUID, user: dict) -> ChatSession:
    row = db.get(ChatSession, session_id)
    # The same answer for "not yours" as for "does not exist", so this cannot be used to
    # discover which session ids are real.
    if row is None or str(row.owner_id) != str(user.get("sub")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    return row


def _message_out(row: ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=row.id,
        role=row.role,
        content=row.content,
        grounded=row.grounded,
        quotes=list(row.quotes or []),
        created_at=row.created_at,
    )


def _summary(row: ChatSession, message_count: int) -> ChatSessionSummary:
    return ChatSessionSummary(
        id=row.id,
        title=row.title,
        document_name=row.document_name,
        document_pages=row.document_pages,
        document_chars=row.document_chars,
        message_count=message_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/sessions", response_model=list[ChatSessionSummary])
def list_sessions(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> list[ChatSessionSummary]:
    """Every chat this researcher owns, newest activity first.

    The document text is deliberately not selected here - it is the largest column in
    the table and the list only needs its name and size.
    """
    counts = (
        select(ChatMessage.session_id, func.count(ChatMessage.id).label("n"))
        .group_by(ChatMessage.session_id)
        .subquery()
    )
    rows = (
        db.query(ChatSession, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.session_id == ChatSession.id)
        .filter(ChatSession.owner_id == uuid.UUID(str(user["sub"])))
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    return [_summary(row, count) for row, count in rows]


@router.post("/sessions", response_model=ChatSessionDetail, status_code=201)
async def create_session(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ChatSessionDetail:
    """Upload a document and start a chat about it.

    The text is extracted once, here, and stored. Every later question then costs one
    model call rather than a re-parse of the file.
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="That file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    try:
        text, pages = extract_text(data, file.filename or "")
    except DocumentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if len(text) > MAX_DOCUMENT_CHARS:
        # Truncated rather than refused: the front of a paper carries its abstract,
        # methods and results, and a book-length upload is still worth answering from.
        logger.info("Truncated an upload of %d chars", len(text))
        text = text[:MAX_DOCUMENT_CHARS]

    row = ChatSession(
        id=uuid.uuid4(),
        owner_id=uuid.UUID(str(user["sub"])),
        title=(title or "").strip() or title_for(file.filename, ""),
        document_name=file.filename,
        document_text=text,
        document_chars=len(text),
        document_pages=pages,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return ChatSessionDetail(**_summary(row, 0).model_dump(), messages=[])


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ChatSessionDetail:
    """One chat and its whole thread, in order."""
    row = _own_session(db, session_id, user)
    messages = [_message_out(message) for message in row.messages]
    return ChatSessionDetail(**_summary(row, len(messages)).model_dump(), messages=messages)


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Delete a chat and its messages. The cascade is declared on the foreign key."""
    row = _own_session(db, session_id, user)
    db.delete(row)
    db.commit()
    return {"deleted": str(session_id)}


@router.post("/sessions/{session_id}/ask", response_model=AskResponse)
async def ask(
    session_id: uuid.UUID,
    request: AskRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> AskResponse:
    """Ask one question about this chat's document, and keep both sides of the exchange."""
    row = _own_session(db, session_id, user)

    # Only the recent turns are replayed; the document passages dominate the call, so a
    # long thread would mostly buy the same tokens again.
    history = [
        {"role": message.role, "content": message.content}
        for message in row.messages[-(MAX_HISTORY_TURNS * 2) :]
    ]

    try:
        result = await answer_from_document(
            document_text=row.document_text,
            document_name=row.document_name,
            question=request.question,
            history=history,
        )
    except LLMQuotaExhausted as exc:
        logger.warning("Quick chat quota exhausted for session=%s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(max(1, int(exc.wait_seconds)))},
        ) from exc
    except LLMError as exc:
        logger.error("Quick chat failed for session=%s: %s", session_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The chat model is unavailable. No answer was produced.",
        ) from exc

    # Written only once an answer exists, so a failed call never leaves a question
    # sitting in the thread with nothing under it.
    now = _now()
    question_row = ChatMessage(
        id=uuid.uuid4(),
        session_id=row.id,
        role="user",
        content=request.question.strip(),
        grounded=None,
        quotes=[],
        created_at=now,
    )
    answer_row = ChatMessage(
        id=uuid.uuid4(),
        session_id=row.id,
        role="assistant",
        content=result["answer"],
        grounded=result["grounded"],
        quotes=result["quotes"],
        created_at=now,
    )
    db.add(question_row)
    db.add(answer_row)

    row.updated_at = now
    if row.title in ("", "New chat") and not row.document_name:
        row.title = title_for(None, request.question)
    db.commit()
    db.refresh(question_row)
    db.refresh(answer_row)

    return AskResponse(
        question=_message_out(question_row),
        answer=_message_out(answer_row),
        partial_context=bool(result.get("partial")),
    )
