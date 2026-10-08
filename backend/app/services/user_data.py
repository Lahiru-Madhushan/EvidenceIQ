"""A researcher's own data: export it, and erase it.

Privacy rights that had no implementation. A researcher could delete a chat, but not a
review, and had no way to see everything the system held about them or to remove it:

* export  - everything stored under the caller's account, in one JSON document
            (GDPR Art. 15 access, Art. 20 portability);
* erase   - every row owned by the caller, removed in one transaction
            (GDPR Art. 17 erasure).

Ownership is the token's `sub`, so neither can reach another researcher's rows. RLS does
not cover the backend's connection, so every query below filters on owner_id itself.

Deletion is explicit child-first rather than relying on ON DELETE CASCADE, so it removes
the same rows whatever database it runs against.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.chat import ChatMessage, ChatSession
from app.models.paper import Paper
from app.models.paper_event import PaperEvent
from app.models.review import Review
from app.models.subscription import Subscription


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _row(obj: Any, fields: list[str]) -> dict:
    return {name: _iso(getattr(obj, name, None)) for name in fields}


def delete_review_rows(db: Session, review_id: uuid.UUID) -> int:
    """Delete one review and everything under it. Returns papers removed. Caller commits."""
    paper_ids = select(Paper.id).where(Paper.review_id == review_id)
    db.execute(delete(PaperEvent).where(PaperEvent.paper_id.in_(paper_ids)))
    removed = db.execute(delete(Paper).where(Paper.review_id == review_id)).rowcount or 0
    db.execute(delete(Review).where(Review.id == review_id))
    return removed


def export_user_data(db: Session, owner_id: uuid.UUID) -> dict:
    reviews = db.query(Review).filter(Review.owner_id == owner_id).all()
    review_ids = [review.id for review in reviews]
    papers = db.query(Paper).filter(Paper.review_id.in_(review_ids)).all() if review_ids else []
    sessions = db.query(ChatSession).filter(ChatSession.owner_id == owner_id).all()
    subscription = db.get(Subscription, owner_id)

    papers_by_review: dict[Any, list[dict]] = {}
    for paper in papers:
        papers_by_review.setdefault(paper.review_id, []).append(
            _row(
                paper,
                [
                    "id", "pmid", "title", "journal", "year", "draft_decision", "draft_reason",
                    "verified_decision", "confidence", "researcher_status", "researcher_note",
                    "retrieved_at", "screened_at", "verified_at", "researcher_decided_at",
                ],
            )
        )

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account_id": str(owner_id),
        "reviews": [
            {
                **_row(review, ["id", "research_question", "raw_criteria", "protocol", "status",
                                "created_at", "updated_at"]),
                "papers": papers_by_review.get(review.id, []),
            }
            for review in reviews
        ],
        "chats": [
            {
                **_row(session, ["id", "title", "document_name", "document_pages",
                                 "document_chars", "created_at", "updated_at"]),
                # The uploaded file itself is not inlined; it is available from the chat's
                # document endpoint, and base64 in JSON would multiply its size.
                "messages": [
                    _row(message, ["role", "content", "grounded", "quotes", "created_at"])
                    for message in session.messages
                ],
            }
            for session in sessions
        ],
        "subscription": (
            _row(subscription, ["plan_id", "billing", "status", "started_at", "renews_at"])
            if subscription
            else None
        ),
    }


def erase_user_data(db: Session, owner_id: uuid.UUID) -> dict:
    """Remove every row owned by this account, in one transaction."""
    review_ids = [
        rid for (rid,) in db.execute(select(Review.id).where(Review.owner_id == owner_id)).all()
    ]
    papers = 0
    for review_id in review_ids:
        papers += delete_review_rows(db, review_id)

    session_ids = select(ChatSession.id).where(ChatSession.owner_id == owner_id)
    db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids)))
    chats = db.execute(delete(ChatSession).where(ChatSession.owner_id == owner_id)).rowcount or 0
    subscriptions = (
        db.execute(delete(Subscription).where(Subscription.owner_id == owner_id)).rowcount or 0
    )
    db.commit()
    return {
        "reviews_deleted": len(review_ids),
        "papers_deleted": papers,
        "chats_deleted": chats,
        "subscription_deleted": bool(subscriptions),
    }
