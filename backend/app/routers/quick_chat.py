"""Quick Chat: upload a document, ask questions about it, keep the thread.

Everything here is scoped to the signed-in researcher by an explicit owner check. The
tables carry RLS policies as well, but this connection is not the user's - the backend
holds one pooled connection - so the check in _own_session is the one actually doing the
work, exactly as in the pipeline router.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

import io
from urllib.parse import quote

from pypdf import PdfReader

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
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
MAX_UPLOAD_BYTES = settings.max_upload_bytes
_READ_CHUNK = 256 * 1024


async def _read_limited(file: UploadFile) -> bytes:
    """Read an upload in chunks, stopping as soon as it passes the size limit.

    `await file.read()` used to buffer the whole body and only then compare its length
    (V-06), so a 2 GB upload was fully resident in memory before being refused. The
    request-size middleware now refuses an oversized request from its Content-Length;
    this is the second line, for a request that did not declare one.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


_UNSAFE_NAME = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')


def _safe_filename(name: str | None) -> str | None:
    """The client's filename, reduced to something safe to store and show back.

    It is attacker-controlled: it can carry a path, control characters or markup, and it
    is displayed in the chat list and sent back in Content-Disposition.
    """
    if not name:
        return None
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = _UNSAFE_NAME.sub("_", base).strip(" .")
    if len(base) > 200:
        # Keep the extension: the text extractor reads .txt/.md files by it.
        stem, dot, ext = base.rpartition(".")
        base = (stem[: 199 - len(ext)] + dot + ext) if dot and len(ext) <= 10 else base[:200]
    return base or None


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
        has_original=row.document_mime is not None,
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
    data = await _read_limited(file)
    if not data:
        raise HTTPException(status_code=422, detail="That file is empty.")
    filename = _safe_filename(file.filename)

    try:
        text, pages = extract_text(data, filename or "")
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
        title=(title or "").strip()[:200] or title_for(filename, ""),
        document_name=filename,
        document_text=text,
        document_chars=len(text),
        document_pages=pages,
        document_file=data,
        # Decided from what the file parsed as, never the client's Content-Type, so the
        # document endpoint cannot be made to serve an upload as HTML.
        document_mime="application/pdf" if pages is not None else "text/plain",
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


@router.get("/sessions/{session_id}/document")
def get_document(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> Response:
    """The uploaded file, for viewing beside the chat.

    Chats from before the original was kept get the extracted text instead - the text
    the answers were actually drawn from - so every chat has something to show.
    """
    row = _own_session(db, session_id, user)

    if row.document_file is not None and row.document_mime:
        body, media_type = row.document_file, row.document_mime
        if media_type == "text/plain":
            media_type = "text/plain; charset=utf-8"
            body = row.document_text.encode("utf-8")
    else:
        body, media_type = row.document_text.encode("utf-8"), "text/plain; charset=utf-8"

    filename = quote(row.document_name or "document")
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{filename}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.put("/sessions/{session_id}/document", response_model=ChatSessionSummary)
async def attach_document(
    session_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> ChatSessionSummary:
    """Attach the original PDF to a chat created before originals were kept.

    Only the file the chat was built from is accepted, checked by page count. The
    answers were drawn from the stored text, so pairing them with a different paper
    would show quotes beside a document they did not come from. The stored text itself
    is left alone for the same reason.
    """
    row = _own_session(db, session_id, user)

    data = await _read_limited(file)
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=422, detail="That file is not a PDF.")

    try:
        pages = len(PdfReader(io.BytesIO(data)).pages)
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="That PDF could not be opened. It may be corrupt."
        ) from exc

    if row.document_pages is not None and pages != row.document_pages:
        raise HTTPException(
            status_code=422,
            detail=f"That PDF has {pages} pages, but this chat's document had "
            f"{row.document_pages}. Please choose the same file you uploaded.",
        )

    row.document_file = data
    row.document_mime = "application/pdf"
    db.commit()

    count = len(row.messages)
    return _summary(row, count)


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
