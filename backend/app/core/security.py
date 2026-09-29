import hashlib
import logging

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

bearer_scheme = HTTPBearer(auto_error=False)

_jwk_client = jwt.PyJWKClient(settings.supabase_jwks_url)

# Structured, separately routable, and never the token itself: a rejected token is logged
# as its failure class plus a short fingerprint, which is enough to correlate repeated
# attempts without writing a credential into the log stream (V-12).
security_log = logging.getLogger("evidenceiq.security")

# Signed with the platform's asymmetric keys only. Listing the algorithms explicitly is
# what defeats "alg": "none" and the HS256-with-the-public-key confusion attack.
_ALLOWED_ALGORITHMS = ["ES256", "RS256"]
# A token without these is not one Supabase issued for a signed-in user.
_REQUIRED_CLAIMS = ["exp", "sub", "aud", "iss"]
# Tolerates a few seconds of clock drift between this host and Supabase, no more.
_LEEWAY_SECONDS = 10


def token_fingerprint(token: str) -> str:
    """A short, non-reversible tag for a token, safe to write to a log."""
    return hashlib.sha256(token.encode("utf-8", "replace")).hexdigest()[:12]


def user_fingerprint(user_id: str | None) -> str:
    """Pseudonymous user id for logs: correlatable, but not the account id itself."""
    if not user_id:
        return "anonymous"
    return hashlib.sha256(str(user_id).encode()).hexdigest()[:12]


def get_bearer_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """The caller's raw JWT, for forwarding on agent-to-agent calls.

    An agent calling another agent does so as the researcher who started the request,
    never as an anonymous service: the downstream agent runs the same ownership checks
    it would for a direct call, so a chained request can never reach data the original
    caller could not.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return credentials.credentials


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    token = credentials.credentials

    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=_ALLOWED_ALGORITHMS,
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            leeway=_LEEWAY_SECONDS,
            options={"require": _REQUIRED_CLAIMS},
        )

    except jwt.PyJWTError as exc:
        # The class name ("ExpiredSignatureError", "InvalidAudienceError", ...) says what
        # went wrong; the message can echo attacker-controlled header content, so it is
        # not logged. The caller gets one generic answer whatever the reason, so the
        # response is no oracle for which check a forged token failed.
        security_log.warning(
            "auth_rejected reason=%s token=%s", type(exc).__name__, token_fingerprint(token)
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    if payload.get("role") not in (None, "authenticated"):
        # A service-role or anon token is a valid Supabase JWT, but it is not a signed-in
        # researcher and must never be accepted as one.
        security_log.warning(
            "auth_rejected reason=UnexpectedRole role=%s token=%s",
            payload.get("role"),
            token_fingerprint(token),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    return payload
