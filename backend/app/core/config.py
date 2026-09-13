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
    # Agent 4 is on a different model *family* from Agent 3, not merely a different
    # checkpoint. gpt-oss-120b satisfied the letter of the rule above while sitting on
    # the same training data and the same blind spots as gpt-oss-20b, so "agreement"
    # between them was weaker evidence than it looked. Qwen was chosen against the real
    # verification prompt: it returns the exact output schema and gets the criterion
    # polarity right (a trial that *excluded* type 1 diabetes is a PASS on
    # "exclude:type1", not a FAIL), which is the case this agent exists to get right.
    #
    # It is also far cheaper - about 1200 tokens a paper against gpt-oss-120b's 3000,
    # because it does not spend most of the completion budget on reasoning - so the same
    # daily quota covers roughly 160 papers instead of 66.
    verification_model: str = "qwen/qwen3.8-27b"

    # Agent 1 (Criteria). Was hardcoded inside the agent, and to the same model as Agent
    # 4 - so the two shared one daily quota with neither aware of the other, and a long
    # screening run left the researcher unable to start a *new* review at all: the system
    # failing at its entry point because of work done at its exit. Moving Agent 4 off
    # gpt-oss-120b resolves that by leaving this model to Agent 1 alone, which at one
    # call per review it will never exhaust. Quotas are per model, so which model an
    # agent uses is also a decision about who it competes with.
    criteria_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: float = 45.0
    llm_max_retries: int = 3

    # The provider's tokens-per-minute budget, applied per model (Groq's free tier is
    # 8000 TPM on each). Calls wait for room in this budget instead of being fired and
    # rejected; see app/services/rate_limit.py. Raise it to match a paid tier, or set it
    # to 0 to disable pacing entirely and rely on retries alone.
    llm_tokens_per_minute: int = 8000

    # The other half of the same meter, and the one that actually stops a long run.
    # Groq's free tier allows 200000 tokens per day per model, which at roughly 2400
    # tokens a verification is about 80 papers - a single large review. It refills
    # continuously like the per-minute budget rather than resetting at midnight.
    llm_tokens_per_day: int = 200_000

    # Output tokens per minute - metered separately from total tokens and usually the
    # tighter of the two. On a 1000 OTPM allowance a model answering in ~380 tokens can
    # only be asked about 2.6 times a minute, whatever the 8000 TPM total allows. This
    # is charged on real output, not on the max_tokens ceiling, so the client measures
    # what answers actually cost rather than reserving the cap. 0 disables it.
    llm_output_tokens_per_minute: int = 1000

    # The seed for that measurement, used only until the first answer comes back.
    llm_expected_output_tokens: int = 500

    # The whole call, retries and provider-requested waits included. It must stay under
    # AGENT_HTTP_TIMEOUT_SECONDS: the orchestrator calls this agent over HTTP and gives
    # up at that point, so anything spent past it is work completed and then discarded -
    # which is what a bare "ReadTimeout" in the orchestrator's log actually was.
    llm_deadline_seconds: float = 90.0

    # The longest a single call will wait for budget before giving up. Past this the
    # honest answer is that the quota is gone, not that the model is unavailable: the
    # caller's own HTTP timeout is 120s, so waiting minutes only converts a clear
    # failure into a confusing one.
    llm_max_wait_seconds: float = 75.0

    # The completion reservation, and the largest single lever on throughput here. The
    # provider charges max_tokens against the per-minute budget the moment the request
    # arrives, whether or not the model goes on to use it: a 700-token prompt with
    # max_tokens=2000 costs 2700 tokens of budget, so a third of the free tier's minute
    # is spent reserving output that is typically a few hundred tokens long.
    #
    # This is a starting point, not a limit. gpt-oss spends this budget on reasoning
    # before it writes any JSON, so how much a paper needs depends on the paper and
    # cannot be known here; the client doubles the cap up to the ceiling below when an
    # answer does not fit, and remembers what the model needed. Starting low therefore
    # costs an occasional extra call rather than a failed verification, while starting
    # high would cost budget on every call whether or not it was needed.
    llm_max_output_tokens: int = 800
    llm_max_output_ceiling: int = 6144

    # gpt-oss models accept "low" | "medium" | "high". Low is the right default here:
    # the prompt already does the analytical work - it fixes the criteria, the statuses
    # and the output shape - so extra reasoning mostly consumes completion budget that
    # the JSON then has none of, which is exactly how this failed before. Blank sends
    # nothing; a provider that rejects the parameter has it dropped automatically.
    llm_reasoning_effort: str = "low"

    # Per-model overrides, "model=effort" separated by commas. The accepted values and
    # their cost differ sharply by family, so one global setting is wrong for somebody:
    #
    #   gpt-oss  "low" | "medium" | "high"   - low is the cheap end
    #   qwen     "none" | "default"          - and "low" is NOT rejected by qwen3.8, it
    #                                          is quietly treated as full reasoning
    #
    # Measured on the real verification prompt, qwen3.8-27b spends 372 completion tokens
    # at "low" and 159 at "none" for the same answer. Since output-per-minute is this
    # agent's binding limit, that one word is a 2.3x difference in papers per minute.
    llm_reasoning_effort_by_model: str = "qwen/qwen3.8-27b=none,qwen/qwen3.6-27b=none"

    supabase_url: str = ""

    # Agent 4 - Verification Agent
    max_abstract_chars: int = 12000
    verify_batch_max: int = 50
    # Concurrency no longer decides the request rate - the token budget does, and extra
    # workers past what the budget can feed just queue at the pacer. It is kept low so a
    # paper does not sit behind three others' waits and time out the agent-to-agent HTTP
    # call: at 8000 TPM and ~1800 tokens a call, two in flight is already the ceiling.
    verify_batch_concurrency: int = 2

    # Agent-to-agent communication.
    # The agents talk to each other over REST/JSON like any other client, so this is
    # where the orchestrator finds them. It points at this same service by default;
    # split the agents onto their own hosts and only this value changes.
    internal_api_base_url: str = "http://localhost:8000"
    # Generous next to llm_timeout_seconds: an agent call is one HTTP round trip that
    # itself contains a model call, so it must outlast the model's own timeout.
    agent_http_timeout_seconds: float = 120.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def reasoning_effort_for(self, model: str) -> str:
        """The reasoning effort this model should be asked for, or "" to send none."""
        for pair in self.llm_reasoning_effort_by_model.split(","):
            name, _, effort = pair.partition("=")
            if name.strip() and name.strip() == model:
                return effort.strip()
        return self.llm_reasoning_effort.strip()

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
