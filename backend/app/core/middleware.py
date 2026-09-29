"""Request-level protection for the whole API.

Three pure-ASGI middlewares, each closing a finding from the security assessment:

* SecurityHeadersMiddleware - the browser-side defences every response should carry
  (V-09), plus `Cache-Control: no-store` so researchers' data is never cached by a
  shared proxy or left in a browser cache.
* BodySizeLimitMiddleware - refuses an oversized request *before* its body is read
  (V-06). The upload route used to buffer the whole file and only then compare its size.
* RateLimitMiddleware - a per-client sliding window over the API (V-05). The LLM token
  pacer in services/rate_limit.py protects the provider's quota; nothing protected the
  API itself, so one scripted client could scrape it or spend the shared PubMed and LLM
  budget for every other researcher.

They are written against raw ASGI rather than BaseHTTPMiddleware so they can refuse a
request without reading its body, and add headers without buffering the response.
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
from collections import deque
from typing import Awaitable, Callable

from app.core.config import settings

logger = logging.getLogger("evidenceiq.security")

Scope = dict
Message = dict
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

# Swagger UI and ReDoc load their scripts and styles from a CDN, so the locked-down CSP
# below would render them blank. They only exist when docs are enabled (never in
# production by default), and get a CSP that allows exactly what they need.
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")
_DOCS_CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self' data: https://fastapi.tiangolo.com "
    "https://cdn.redoc.ly; connect-src 'self'; frame-ancestors 'none'"
)
# An API returns JSON and files, never pages. Nothing it serves should run script, load
# anything, or be framed.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


async def _send_json(send: Send, status: int, body: dict, headers: list[tuple[bytes, bytes]] | None = None) -> None:
    payload = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
                *(headers or []),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})


# --------------------------------------------------------------------------- headers


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        is_docs = path.startswith(_DOCS_PATHS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}

                def add(name: str, value: str) -> None:
                    if name.encode() not in present:
                        headers.append((name.encode(), value.encode()))

                add("x-content-type-options", "nosniff")
                add("x-frame-options", "DENY")
                add("referrer-policy", "no-referrer")
                add("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()")
                add("cross-origin-opener-policy", "same-origin")
                add("content-security-policy", _DOCS_CSP if is_docs else _API_CSP)
                # Every /api response is about one researcher; none of it may be stored
                # by a shared cache or linger in the browser's.
                if path.startswith("/api"):
                    add("cache-control", "no-store")
                if settings.is_production:
                    add("strict-transport-security", "max-age=31536000; includeSubDomains")
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


# --------------------------------------------------------------------------- body size


class _BodyTooLarge(Exception):
    pass


# The routes that accept a file. Everything else takes JSON and gets the small limit.
_UPLOAD_ROUTE = re.compile(r"^/api/quick-chat/sessions(?:/[^/]+/document)?/?$")
# Multipart framing (boundaries, part headers, the title field) on top of the file itself.
_MULTIPART_OVERHEAD = 64 * 1024


def _body_limit(method: str, path: str) -> int:
    if method in ("POST", "PUT") and _UPLOAD_ROUTE.match(path):
        return settings.max_upload_bytes + _MULTIPART_OVERHEAD
    return settings.max_request_bytes


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return

        limit = _body_limit(scope["method"], scope["path"])
        too_large = {
            "detail": f"Request body is larger than the {limit // (1024 * 1024) or 1} MB limit."
        }

        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    # Refused on the header alone: not one byte of the body is read.
                    await _send_json(send, 413, too_large)
                    return
            except ValueError:
                await _send_json(send, 400, {"detail": "Invalid Content-Length header."})
                return

        # A chunked request has no length up front, so the running total is counted as
        # the body arrives and the request is cut off the moment it passes the limit.
        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await _send_json(send, 413, too_large)


# --------------------------------------------------------------------------- rate limit

# The routes that cost a PubMed or LLM call when written to.
_EXPENSIVE = re.compile(
    r"^/api/(?:retrieval|screen|verify|pipeline|criteria/(?:submit|clarify)"
    r"|papers/[^/]+/chat|quick-chat/sessions(?:/[^/]+/ask)?)"
)
_EXEMPT = ("/api/health",)
_WINDOW_SECONDS = 60.0
# Stale client entries are swept once the table grows past this, so a stream of new
# addresses cannot grow memory without bound.
_MAX_TRACKED_CLIENTS = 10_000


def client_address(scope: Scope) -> str:
    """The caller's address, taking the proxy's word for it only when configured to."""
    if settings.trust_proxy_headers:
        forwarded = dict(scope.get("headers", [])).get(b"x-forwarded-for")
        if forwarded:
            # The proxy APPENDS the address it saw. Anything to the left of that was
            # written by the client and proves nothing, so the right-most entry is the
            # only one that cannot be forged.
            return forwarded.decode("latin-1").split(",")[-1].strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


class SlidingWindow:
    """Timestamps of recent requests per key; a request is allowed while fewer than
    `limit` fall inside the window."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str, limit: int, now: float) -> tuple[bool, int]:
        """(allowed, seconds until the next request would be allowed)."""
        window = self._hits.setdefault(key, deque())
        cutoff = now - _WINDOW_SECONDS
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= limit:
            return False, max(1, math.ceil(window[0] + _WINDOW_SECONDS - now))
        window.append(now)
        if len(self._hits) > _MAX_TRACKED_CLIENTS:
            self._sweep(cutoff)
        return True, 0

    def _sweep(self, cutoff: float) -> None:
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= cutoff]:
            del self._hits[key]

    def reset(self) -> None:
        self._hits.clear()


class RateLimitMiddleware:
    """Per-client request limits.

    In-process state, so each server worker counts on its own - the deployment runs one
    worker. Moving to several workers or hosts means moving this table to Redis.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.window = SlidingWindow()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or not settings.rate_limit_enabled
            or scope["method"] == "OPTIONS"
            or not scope["path"].startswith("/api")
            or scope["path"].startswith(_EXEMPT)
        ):
            await self.app(scope, receive, send)
            return

        client = client_address(scope)
        now = time.monotonic()

        buckets = [("all", settings.rate_limit_per_minute)]
        if scope["method"] in ("POST", "PUT") and _EXPENSIVE.match(scope["path"]):
            buckets.append(("expensive", settings.rate_limit_expensive_per_minute))

        for bucket, limit in buckets:
            allowed, retry_after = self.window.check(f"{bucket}:{client}", limit, now)
            if not allowed:
                logger.warning(
                    "rate_limited client=%s bucket=%s path=%s", client, bucket, scope["path"]
                )
                await _send_json(
                    send,
                    429,
                    {"detail": "Too many requests. Please slow down and try again shortly."},
                    [(b"retry-after", str(retry_after).encode())],
                )
                return

        await self.app(scope, receive, send)
