"""How one agent calls another: REST/JSON over HTTP.

Every agent in EvidenceIQ is reachable only through its own HTTP endpoint. When the
orchestrator needs Agent 3's opinion it makes the same POST /api/screen call the
frontend would - it does not import the agent's Python function. That costs a network
round trip, and buys three things worth having:

* One contract per agent, not two. The endpoint IS the agent's interface, so there is
  no way for an internal caller to bypass the validation, auth or error handling that
  an external caller goes through.
* The agents can be split across processes or hosts by changing a base URL, because
  nothing in the call path assumes they share memory.
* Every hand-off is a real HTTP request, so it can be logged, replayed from a Postman
  collection, or watched in the network tab during a demo.

The caller's JWT is forwarded on every hop (see get_bearer_token), so the downstream
agent authenticates and authorises the original researcher, not a service account.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.schemas.paper import Paper
from app.schemas.protocol import Protocol
from app.schemas.screening import ScreeningDecision
from app.schemas.verification import VerificationResult

logger = logging.getLogger(__name__)


class AgentCallError(RuntimeError):
    """A downstream agent could not be reached, or answered with an error status."""

    def __init__(self, agent: str, message: str, status_code: int | None = None):
        self.agent = agent
        self.status_code = status_code
        super().__init__(message)


class AgentClient:
    """Talks to the other agents over HTTP on behalf of one authenticated researcher."""

    def __init__(self, token: str, base_url: str | None = None):
        self._token = token
        self._base_url = (base_url or settings.internal_api_base_url).rstrip("/")

    async def _post(self, agent: str, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self._base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(
                timeout=settings.agent_http_timeout_seconds
            ) as client:
                response = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise AgentCallError(agent, f"{agent} is unreachable at {url}: {exc}") from exc

        if response.status_code != 200:
            # Pass the downstream agent's own reason up rather than inventing one -
            # a 502 from the model and a 403 from ownership need different fixes.
            detail = _extract_detail(response)
            raise AgentCallError(
                agent,
                f"{agent} returned HTTP {response.status_code}: {detail}",
                status_code=response.status_code,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise AgentCallError(agent, f"{agent} did not return JSON.") from exc

    async def screen(self, paper: Paper, protocol: Protocol) -> ScreeningDecision:
        """Ask Agent 3 (Screening) for a draft decision. POST /api/screen"""
        body = await self._post(
            "Agent 3 (Screening)",
            "/api/screen",
            {"paper": paper.model_dump(mode="json"), "protocol": protocol.model_dump(mode="json", by_alias=True)},
        )
        return ScreeningDecision.model_validate(body)

    async def verify(
        self,
        paper: Paper,
        protocol: Protocol,
        screening_decision: ScreeningDecision,
    ) -> VerificationResult:
        """Ask Agent 4 (Verification) to re-check that decision. POST /api/verify"""
        body = await self._post(
            "Agent 4 (Verification)",
            "/api/verify",
            {
                "paper": paper.model_dump(mode="json"),
                "protocol": protocol.model_dump(mode="json", by_alias=True),
                "screening_decision": screening_decision.model_dump(mode="json"),
            },
        )
        return VerificationResult.model_validate(body)

    async def submit_criteria(self, research_question: str, raw_criteria: str) -> dict[str, Any]:
        """Ask Agent 1 (Criteria) to build a protocol. POST /api/criteria/submit

        Returns the raw body: Agent 1 answers with one of two different shapes, and
        which one it is (a protocol, or a clarifying question) is the caller's decision
        to act on, not something to flatten away here.
        """
        return await self._post(
            "Agent 1 (Criteria)",
            "/api/criteria/submit",
            {"research_question": research_question, "raw_criteria": raw_criteria},
        )

    async def retrieve(
        self,
        review_id: str,
        query: str,
        *,
        max_results: int = 20,
        page_size: int = 10,
        year_from: int | None = None,
        year_to: int | None = None,
    ) -> dict[str, Any]:
        """Ask Agent 2 (Retrieval) to fetch and store papers. POST /api/retrieval/search"""
        payload: dict[str, Any] = {
            "review_id": review_id,
            "query": query,
            "max_results": max_results,
            "page_size": page_size,
        }
        if year_from is not None:
            payload["year_from"] = year_from
        if year_to is not None:
            payload["year_to"] = year_to
        return await self._post("Agent 2 (Retrieval)", "/api/retrieval/search", payload)


def _extract_detail(response: httpx.Response) -> str:
    """FastAPI puts the reason in {"detail": ...}; fall back to raw text."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:300]
    if isinstance(body, dict) and "detail" in body:
        return str(body["detail"])[:300]
    return str(body)[:300]
