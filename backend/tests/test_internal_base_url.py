"""Where this service reaches itself, when something else picks the port.

The orchestrator hands work to the other agents over HTTP, and on a single host that
means calling back into this same process. A hardcoded port survives local development,
where uvicorn is started by hand on 8000, and then fails silently in deployment: Render
runs `uvicorn --port $PORT` and assigns 10000, so every agent-to-agent call went to a
port nothing was listening on.

The failure was easy to miss because it is partial. /api/screen, /api/verify,
/api/criteria/submit and /api/retrieval/search are called directly by the browser and
kept working; only /api/pipeline/*, which is the one that calls back into itself, broke -
and only in production.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings, _default_internal_api_base_url


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.delenv("INTERNAL_API_BASE_URL", raising=False)


def test_it_follows_the_port_the_platform_assigned(monkeypatch):
    """The deployment case: Render sets PORT and uvicorn binds it."""
    monkeypatch.setenv("PORT", "10000")
    assert _default_internal_api_base_url() == "http://127.0.0.1:10000"


def test_it_still_defaults_to_8000_for_local_development():
    """Nothing sets PORT when you run uvicorn by hand, and 8000 is what you get."""
    assert _default_internal_api_base_url() == "http://127.0.0.1:8000"


def test_it_uses_the_loopback_address_not_the_hostname():
    """localhost can resolve to ::1 first, where a 0.0.0.0 bind is not listening."""
    assert "127.0.0.1" in _default_internal_api_base_url()
    assert "localhost" not in _default_internal_api_base_url()


def test_an_explicit_setting_still_wins(monkeypatch):
    """Splitting the agents onto their own hosts must remain a one-value change."""
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setenv("INTERNAL_API_BASE_URL", "https://agents.example.com")
    assert Settings().internal_api_base_url == "https://agents.example.com"


def test_the_setting_is_resolved_per_instance(monkeypatch):
    """Read at construction, not at import - or a test could never change it."""
    monkeypatch.setenv("PORT", "3000")
    assert Settings().internal_api_base_url == "http://127.0.0.1:3000"
    monkeypatch.setenv("PORT", "4000")
    assert Settings().internal_api_base_url == "http://127.0.0.1:4000"


def test_the_agent_client_builds_its_urls_from_it(monkeypatch):
    """The setting is only worth fixing if this is what actually consumes it."""
    from app.services.agent_client import AgentClient

    monkeypatch.setenv("PORT", "10000")
    client = AgentClient("token", base_url=Settings().internal_api_base_url)
    assert client._base_url == "http://127.0.0.1:10000"
