from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "EvidenceIQ"
    environment: str = "development"
    database_url: str = "sqlite:///./evidenceiq.db"
    cors_origins: str = "http://localhost:5173"
    pubmed_api_base: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    llm_provider: str = "groq"
    llm_api_key: str = ""
    supabase_url: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"


settings = Settings()
