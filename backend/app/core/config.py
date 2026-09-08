from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # Deliberately not the model Agent 3 uses: two agents sharing one model share its
    # blind spots, and a verification pass that fails the same way twice verifies nothing.
    llm_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 2
    supabase_url: str = ""

    # Agent 4 - Verification Agent
    max_abstract_chars: int = 12000
    verify_batch_max: int = 50
    verify_batch_concurrency: int = 4

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"


settings = Settings()
