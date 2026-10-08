import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, user_fingerprint
from app.services.user_data import erase_user_data, export_user_data

router = APIRouter(tags=["users"])
security_log = logging.getLogger("evidenceiq.security")

# Erasure cannot be undone, so it has to be asked for in words rather than by a stray
# request: a mistaken click or a replayed call must not wipe someone's reviews.
ERASE_CONFIRMATION = "DELETE MY DATA"


class EraseRequest(BaseModel):
    confirm: str


def _owner(user: dict) -> uuid.UUID:
    try:
        return uuid.UUID(str(user.get("sub")))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user.") from exc


@router.get("/me")
def get_me(user: dict = Depends(get_current_user)):
    return {
        "id": user.get("sub"),
        "email": user.get("email"),
        "full_name": (user.get("user_metadata") or {}).get("full_name"),
    }


@router.get("/me/export")
def export_my_data(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Everything stored under the signed-in account, as one JSON document."""
    security_log.info("data_export user=%s", user_fingerprint(user.get("sub")))
    return export_user_data(db, _owner(user))


@router.delete("/me/data")
def erase_my_data(
    request: EraseRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> dict:
    """Permanently delete every review, paper, chat and subscription on this account.

    The sign-in itself is held by Supabase Auth, which this service cannot delete without
    an admin key it deliberately does not hold; the response says so.
    """
    if request.confirm.strip() != ERASE_CONFIRMATION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f'To confirm, send {{"confirm": "{ERASE_CONFIRMATION}"}}.',
        )
    result = erase_user_data(db, _owner(user))
    security_log.warning("data_erased user=%s %s", user_fingerprint(user.get("sub")), result)
    return {
        **result,
        "note": "Your EvidenceIQ data has been deleted. Your sign-in account is managed by "
        "Supabase Auth; ask an administrator to remove it as well.",
    }
