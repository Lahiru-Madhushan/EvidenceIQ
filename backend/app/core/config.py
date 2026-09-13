import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_internal_api_base_url() -> str:
    """Where this service can reach itself, whatever port it was told to listen on.

    The orchestrator hands work to the other agents over HTTP, and on one host that
    means calling back into this same process. A hardcoded port is wrong the moment
    something else chooses it: Render runs `uvicorn --port $PORT` and assigns 10000, so
    a default of 8000 pointed every agent-to-agent call at a port with nothing on it.
    The single-agent endpoints kept working, which is what made it easy to miss - only
    /api/pipeline/* broke, and only in production.

    127.0.0.1 rather than localhost on purpose: localhost can resolve to ::1 first, and
    uvicorn bound to 0.0.0.0 is not listening there.
    """
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


class Settings(BaseSettings):
    app_name: str = "EvidenceIQ"
    environment: str = "development"
    database_url: str = "sqlite:///./evidenceiq.db"
    cors_origins: str = "http://localhost:5173"
    pubmed_api_base: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    llm_provider: str = "groq"
    llm_api_key: str = ""
    # Groq speaks the OpenAI chat-completions dialect, so changing provider is a URL change.
    llm_base_url: str = "https://api.groq.com/openai/v1"
    # Generic fallback for any caller that does not name a model. Agents 3 and 4 both
    # name theirs explicitly below - relying on this default is what let them silently
    # converge on one model.
    llm_model: str = "openai/gpt-oss-120b"

    # Agent 3 and Agent 4 MUST NOT share a model. Two agents on one model share its
    # blind spots, and a verification pass that fails the same way twice verifies
    # nothing - "agreement" would stop being evidence of anything. Both are named here
    # rather than inherited, so pointing one at a different model is a visible edit and
    # never a side effect of changing a shared default. check_agent_models() enforces it
    # at startup; see app/main.py.
    screening_model: str = "openai/gpt-oss-20b"
    verification_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 2
    supabase_url: str = ""

    # Agent 4 - Verification Agent
    max_abstract_chars: int = 12000
    verify_batch_max: int = 50
    verify_batch_concurrency: int = 4

    # Agent-to-agent communication.
    # The agents talk to each other over REST/JSON like any other client, so this is
    # where the orchestrator finds them. It points at this same service by default, on
    # whatever port this process was told to listen on; split the agents onto their own
    # hosts and only this value changes. Set INTERNAL_API_BASE_URL to override.
    internal_api_base_url: str = Field(default_factory=_default_internal_api_base_url)
    # Generous next to llm_timeout_seconds: an agent call is one HTTP round trip that
    # itself contains a model call, so it must outlast the model's own timeout.
    agent_http_timeout_seconds: float = 120.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"


settings = Settings()


class AgentModelConflict(RuntimeError):
    """Agents 3 and 4 are pointed at the same model, which voids verification."""


def check_agent_models(config: "Settings | None" = None) -> None:
    """Refuse to start if the screening and verification agents share a model.

    This fails loudly on purpose. If the two agents converge on one model, every test
    still passes and every response still looks right - the only thing that changes is
    that `agreement` quietly stops being evidence, which is the one property the
    four-agent design exists to provide. A silent loss of a safety property is worse
    than a refused startup, so this refuses.
    """
    config = config or settings
    if config.screening_model == config.verification_model:
        raise AgentModelConflict(
            "SCREENING_MODEL and VERIFICATION_MODEL are both "
            f"'{config.screening_model}'. Agents 3 and 4 must use different models: two "
            "agents sharing one model share its blind spots, so their agreement would no "
            "longer mean the paper was independently confirmed. Set them to different "
            "models in backend/.env."
        )
