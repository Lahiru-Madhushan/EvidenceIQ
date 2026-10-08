"""The few Stripe API calls billing needs, over plain httpx.

Not the `stripe` package: four endpoints and an HMAC check do not justify a dependency,
and httpx is already how this backend talks to every other provider - which also means
the tests can stand in for Stripe with the same MockTransport they use elsewhere.

Only Checkout is used. The researcher types their card into Stripe's own hosted page,
so no card number ever reaches this server, and this server never has to be trusted
with one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Session ids go into a URL path, so they are checked against Stripe's own shape first.
_SESSION_ID = re.compile(r"^cs_(test|live)_[A-Za-z0-9]{10,200}$")

# How old a webhook signature may be. Stripe's own libraries default to five minutes;
# an older one is a replay, whatever its signature says.
WEBHOOK_TOLERANCE_SECONDS = 300


class StripeError(Exception):
    """Stripe could not be reached, or refused the request."""


class StripeNotConfigured(StripeError):
    """No secret key is set, so no payment can be taken."""


class InvalidSignature(Exception):
    """A webhook whose signature does not prove it came from Stripe."""


def _http_client() -> httpx.AsyncClient:
    """One place the HTTP client is made, so tests can hand Stripe's calls a fake."""
    return httpx.AsyncClient(timeout=settings.stripe_timeout_seconds)


def configured() -> bool:
    return bool(settings.stripe_secret_key)


def valid_session_id(session_id: str) -> bool:
    return bool(_SESSION_ID.match(session_id or ""))


def _form(params: dict[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    """Flatten nested params into Stripe's bracketed form encoding.

    {"line_items": [{"quantity": 1}]} -> [("line_items[0][quantity]", "1")]
    """
    pairs: list[tuple[str, str]] = []
    for key, value in params.items():
        name = f"{prefix}[{key}]" if prefix else str(key)
        if isinstance(value, dict):
            pairs.extend(_form(value, name))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                if isinstance(item, dict):
                    pairs.extend(_form(item, f"{name}[{index}]"))
                else:
                    pairs.append((f"{name}[{index}]", str(item)))
        elif value is not None:
            pairs.append((name, "true" if value is True else "false" if value is False else str(value)))
    return pairs


async def _call(
    method: str,
    path: str,
    *,
    data: list[tuple[str, str]] | None = None,
    params: list[tuple[str, str]] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    if not configured():
        raise StripeNotConfigured("Payments are not configured on this server.")

    headers = {"Authorization": f"Bearer {settings.stripe_secret_key}"}
    content = None
    if data is not None:
        # Encoded here: httpx only form-encodes a dict, and Stripe's repeated and
        # bracketed keys need the ordered pairs. Handed over as a list, httpx would
        # take it for a raw sync byte stream and refuse it on an async client.
        content = urlencode(data)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if idempotency_key:
        # A retried "create" returns the first result instead of a second checkout.
        headers["Idempotency-Key"] = idempotency_key

    try:
        async with _http_client() as client:
            response = await client.request(
                method, f"{settings.stripe_api_base}{path}", headers=headers, content=content, params=params
            )
    except httpx.HTTPError as exc:
        raise StripeError(f"Could not reach Stripe ({type(exc).__name__}).") from exc

    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        message = (body.get("error") or {}).get("message") or f"HTTP {response.status_code}"
        logger.warning("Stripe refused %s %s: HTTP %d", method, path, response.status_code)
        raise StripeError(f"Stripe refused the request: {message}")
    return body


async def create_checkout_session(params: dict[str, Any], *, idempotency_key: str) -> dict[str, Any]:
    return await _call(
        "POST", "/checkout/sessions", data=_form(params), idempotency_key=idempotency_key
    )


async def retrieve_checkout_session(session_id: str) -> dict[str, Any]:
    """The session with its charge expanded, which is where the card and receipt live."""
    if not valid_session_id(session_id):
        raise StripeError("That is not a Stripe checkout session id.")
    return await _call(
        "GET",
        f"/checkout/sessions/{session_id}",
        params=[("expand[]", "payment_intent.latest_charge")],
    )


async def expire_checkout_session(session_id: str) -> dict[str, Any]:
    if not valid_session_id(session_id):
        raise StripeError("That is not a Stripe checkout session id.")
    return await _call("POST", f"/checkout/sessions/{session_id}/expire")


def verify_webhook(
    payload: bytes,
    signature_header: str | None,
    secret: str,
    *,
    tolerance: int = WEBHOOK_TOLERANCE_SECONDS,
    now: float | None = None,
) -> dict[str, Any]:
    """The event, if `signature_header` proves Stripe sent exactly `payload`.

    Stripe signs "<timestamp>.<raw body>" with HMAC-SHA256 under the endpoint's secret
    and sends `t=<timestamp>,v1=<hex>`. The raw bytes are checked, never a re-serialised
    parse of them, and the timestamp bounds how long a captured request stays replayable.
    """
    if not secret:
        raise InvalidSignature("No webhook secret is configured.")
    if not signature_header:
        raise InvalidSignature("Missing Stripe-Signature header.")

    timestamp = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not timestamp.isdigit() or not signatures:
        raise InvalidSignature("Malformed Stripe-Signature header.")

    signed = timestamp.encode() + b"." + payload
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signatures):
        raise InvalidSignature("Signature does not match.")

    age = (now if now is not None else time.time()) - int(timestamp)
    if abs(age) > tolerance:
        raise InvalidSignature("Signature timestamp is outside the tolerance.")

    try:
        return json.loads(payload)
    except ValueError as exc:
        raise InvalidSignature("Body is not JSON.") from exc
