from pydantic_settings import BaseSettings, SettingsConfigDict


def _lookup(mapping: str, model: str) -> str | None:
    """Read a "model=value,model=value" setting, or None if this model is not listed.

    Several settings below are per model rather than global, because the things they
    describe - which provider serves a model, what it costs, how much of it a day buys -
    are properties of the model and not of this application. They share this parser so
    adding another per-model setting is one line rather than another loop.

    An empty value is a real answer ("send nothing"), which is why this returns None for
    absent rather than "" - the two mean different things to the caller.
    """
    for pair in mapping.split(","):
        name, sep, value = pair.partition("=")
        if sep and name.strip() == model:
            return value.strip()
    return None


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

    # --- A second provider, available but not in use --------------------------------
    #
    # Gemini also exposes an OpenAI-compatible endpoint, so it needs no new client: the
    # same code path serves it with a different base URL and key. What it needs is for
    # those two to stop being global, which is what provider_for() below does.
    #
    # Nothing is pointed at it by default. It is kept wired up and tested because it is
    # the escape hatch when a Groq model is retired, rate-limited or simply worse - and
    # because a second vendor is the strongest form of the rule that Agents 3 and 4 must
    # not share blind spots. Moving Agent 4 here is one line: set VERIFICATION_MODEL to
    # a model listed in llm_provider_by_model.
    #
    # Measured on the real verification prompt, gemini-3.6-flash costs 724 tokens a paper
    # against qwen's ~730 - close enough that it is not the reason to switch. The reason
    # would be a much larger daily allowance, or losing access to a Groq model.
    #
    # Keys stay in their own variables rather than inside the mapping string: an API key
    # embedded in a comma-separated list is one careless log line away from being public.
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    # Model ids move: gemini-2.5-flash is already refused for keys issued now
    # ("no longer available to new users"). GET {gemini_base_url}/models lists what a
    # key can actually reach, which is the only reliable answer.
    # "model=provider". A model named here uses that provider's key and URL; anything
    # unlisted falls back to llm_api_key/llm_base_url above, so adding this changed
    # nothing for Agents 1 and 3 or for either chat feature.
    llm_provider_by_model: str = "gemini-3.6-flash=gemini"
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
    #
    # It stays on Groq, and it stays on qwen, because measurement said so. When this
    # agent was exhausting its quota every afternoon the obvious reading was that qwen
    # was the wrong model; benchmarked against the real verification prompt on the same
    # two papers, it is the best of the three text models the key can reach:
    #
    #     qwen/qwen3.8-27b      0.42s / 0.27s     798 / 665 tokens    both correct
    #     openai/gpt-oss-120b   0.69s / 1.06s     966 / 1017 tokens   both correct
    #     openai/gpt-oss-20b    0.92s / 0.69s    1150 / 907 tokens    both correct
    #
    # It is faster and cheaper on this task than Agent 3's own model would be, so
    # "put Agent 4 on something more like Agent 3" would have made it worse. What was
    # actually costing the quota was the prompt (2524 characters, now 1492) and
    # reservations never refunded after a failed attempt - both since fixed. gpt-oss-120b
    # is additionally disqualified: it is Agent 1's model, and an agent that runs per
    # paper would exhaust the quota an agent that runs per review depends on.
    verification_model: str = "qwen/qwen3.8-27b"

    # Where Agent 4 goes when qwen cannot answer. Tried in order, first working one
    # wins; see complete_json_routed in app/services/llm.py.
    #
    # A daily quota is the one failure this system could not previously absorb. Screening
    # is committed the moment Agent 3 finishes, so a spent Agent 3 budget costs the
    # researcher nothing they had already earned - but a spent Agent 4 budget left every
    # remaining paper with one opinion instead of two, and one opinion is precisely what
    # this agent exists to stop being enough. A fallback turns that from a failed paper
    # into a slower one.
    #
    # The fallback must satisfy every rule the primary does, and check_agent_models()
    # enforces that over the whole chain rather than the first entry. Falling over onto
    # Agent 3's own model would be worse than failing: the paper would come back
    # "verified" by the model that screened it, and agreement between a model and itself
    # is not evidence of anything. That is a silent loss of the property, which is the
    # one kind of failure worth refusing to start over.
    #
    # Ordered by how independent the second opinion stays, not by how fast the model is.
    # Every link is a real budget of its own - Groq meters per model, so four models is
    # four daily allowances rather than one shared between them:
    #
    #   gemini-3.6-flash              different vendor entirely; the strongest second
    #                                 opinion available, but only ~20 requests a day free
    #   openai/gpt-oss-120b           Agent 1's model. Same family as Agent 3, so its
    #                                 agreement is weaker evidence - see below. Only
    #                                 reached once two budgets are gone, by which point
    #                                 Agent 1's own needs (one call per review) are
    #                                 rounding error against what is left
    #   openai/gpt-oss-safeguard-20b  the chat feature's model, same reasoning again, and
    #                                 last because it is closest of all to Agent 3
    #
    # The last two share a training lineage with Agent 3, so a verification from them is
    # less independent than one from qwen or Gemini. That is a real cost and the agent
    # records it on the result rather than hiding it (see app/agents/verification/
    # agent.py) - but a weaker second opinion that says so is worth more than no second
    # opinion at all, which is what the chain ending early actually means.
    #
    # Empty disables fallback entirely and Agent 4 fails as it used to.
    verification_model_fallbacks: str = (
        "gemini-3.6-flash,openai/gpt-oss-120b,openai/gpt-oss-safeguard-20b"
    )

    # Agent 1 (Criteria). Was hardcoded inside the agent, and to the same model as Agent
    # 4 - so the two shared one daily quota with neither aware of the other, and a long
    # screening run left the researcher unable to start a *new* review at all: the system
    # failing at its entry point because of work done at its exit. Moving Agent 4 off
    # gpt-oss-120b resolves that by leaving this model to Agent 1 alone, which at one
    # call per review it will never exhaust. Quotas are per model, so which model an
    # agent uses is also a decision about who it competes with.
    criteria_model: str = "openai/gpt-oss-120b"

    # "Chat with paper" - grounded Q&A over one paper, not one of the four agents.
    # Pointed at a model no agent uses, so a researcher asking questions can never eat
    # the quota a screening run needs; quotas are per model, and that is the cheapest
    # way to stop an interactive feature starving a batch one.
    #
    # Do not point this at groq/compound: those models can search the web, and this
    # feature's entire guarantee is that the answer came from the paper in front of you.
    chat_model: str = "openai/gpt-oss-safeguard-20b"
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

    # --- Per-model overrides of the three budgets above ------------------------------
    #
    # The numbers above describe Groq's free tier. They are not facts about "an LLM",
    # they are facts about one provider's plan, so a second provider needs its own - and
    # applying Groq's to Gemini would throttle it to a fraction of what it allows while
    # still letting it blow through limits Groq does not have.
    #
    # The shapes genuinely differ, and not in the direction first assumed here. Groq
    # meters tokens per day - 200000, generous enough for a few hundred papers. Gemini's
    # free tier meters REQUESTS per day, and for gemini-3.6-flash that is 20. Measured,
    # not read off a page: the router fell over to it and got
    # "Quota exceeded for metric: generate_content_free_tier_requests, limit: 20".
    #
    # That is the whole reason it is a fallback and not the primary. Twenty papers is a
    # rounding error against a review; twenty papers is also exactly what is needed to
    # finish the run in front of you when Groq's day runs out mid-review.
    #
    # This module has no request-per-day bucket, only token ones, so Gemini's real limit
    # is expressed in the currency available: 20 requests at roughly 800 tokens a
    # verification is about 16000 tokens. That makes the pacer stop at approximately the
    # right place instead of waving through calls the provider will refuse.
    #
    # VERIFY THESE AGAINST YOUR OWN CONSOLE before trusting them. Free-tier limits change
    # without notice, and a number set too high here does not fail safely: it means the
    # pacer waves calls through and the provider rejects them, which is the exact
    # situation app/services/rate_limit.py exists to avoid. Too low is merely slow.
    # Whatever is set, the client corrects itself from the provider's own figures the
    # first time it is refused - see TokenBucket.resync.
    #
    # "model=tokens", comma separated. Unlisted models use the global values above.
    llm_tokens_per_minute_by_model: str = "gemini-3.6-flash=250000"
    llm_tokens_per_day_by_model: str = "gemini-3.6-flash=16000"
    # 0 means "not separately metered". Gemini does not publish an output-per-minute
    # limit, and inventing one would throttle for no reason - the total budget already
    # covers it.
    llm_output_tokens_per_minute_by_model: str = "gemini-3.6-flash=0"

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
    #   gemini   "none" | "low" | ...       - and NOT optional in practice. Measured
    #                                          against the live API: at "none" a
    #                                          verification costs 91 completion tokens
    #                                          and at "low" 84, but OMITTING the
    #                                          parameter answers 503 rather than
    #                                          defaulting to something cheap. Gemini 3
    #                                          reasons by default, and left to itself it
    #                                          spends the whole completion budget
    #                                          thinking and returns empty content.
    llm_reasoning_effort_by_model: str = (
        "qwen/qwen3.8-27b=none,qwen/qwen3.6-27b=none,gemini-3.6-flash=none"
    )

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

    # Request-level protection (see app/core/middleware.py).
    # These guard the API itself. The LLM token pacer in services/rate_limit.py guards
    # the provider's quota; neither does the other's job.
    rate_limit_enabled: bool = True
    # Every /api request, per client.
    rate_limit_per_minute: int = 120
    # The routes that cost a PubMed or LLM call. One client looping on these can spend
    # the shared quota for everyone, so they get a much tighter allowance.
    rate_limit_expensive_per_minute: int = 20
    # Behind Render's proxy every request arrives from the proxy's address, so the real
    # client is the address the proxy appended to X-Forwarded-For. Off by default: a
    # client can write that header itself, so it is only trustworthy behind a proxy.
    trust_proxy_headers: bool = False
    # Largest JSON body accepted, refused from the Content-Length header before any of
    # it is read. Uploads have their own, larger limit.
    max_request_bytes: int = 1_000_000
    max_upload_bytes: int = 20 * 1024 * 1024

    # Interactive docs (/docs, /redoc, /openapi.json) are useful in development and a map
    # for an attacker in production. Unset means "on everywhere except production".
    enable_api_docs: bool | None = None

    # NCBI E-utilities. Anonymous use is capped at 3 requests/second per IP and can be
    # throttled for the whole deployment; a key raises that to 10 and attributes the
    # traffic. Both are optional.
    ncbi_api_key: str = ""
    ncbi_tool: str = "EvidenceIQ"
    ncbi_email: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def api_docs_enabled(self) -> bool:
        if self.enable_api_docs is not None:
            return self.enable_api_docs
        return not self.is_production

    @property
    def verification_chain(self) -> list[str]:
        """Agent 4's models in the order they are tried, primary first.

        Duplicates are dropped rather than rejected: a fallback that repeats the primary
        would simply ask a spent quota the same question twice.
        """
        chain = [self.verification_model.strip()]
        for name in self.verification_model_fallbacks.split(","):
            candidate = name.strip()
            if candidate and candidate not in chain:
                chain.append(candidate)
        return [name for name in chain if name]

    @staticmethod
    def vendor_of(model: str) -> str:
        """The family a model belongs to, for judging how independent two of them are.

        Coarse on purpose. "openai/gpt-oss-20b" and "openai/gpt-oss-120b" are different
        checkpoints of one lineage, and the thing that matters about them is the shared
        training data rather than the parameter count - so the vendor prefix is the right
        granularity. A bare id with no prefix is read up to its first dash, which puts
        every gemini-* together.
        """
        head = model.split("/")[0].strip().lower()
        return head.split("-")[0] if "/" not in model else head

    def provider_for(self, model: str) -> tuple[str, str]:
        """The (api_key, base_url) this model is served by.

        A model listed in llm_provider_by_model uses that provider's credentials; every
        other model keeps the global pair, so introducing a second provider cannot
        silently redirect the agents that were not moved.

        A named provider with no key configured returns an empty key rather than quietly
        falling back to the default one. Falling back would send a Groq key to Google,
        which fails with an authentication error that says nothing about the real
        mistake; an empty key produces the client's own "LLM_API_KEY is not set" instead.
        """
        provider = _lookup(self.llm_provider_by_model, model)
        if provider == "gemini":
            return self.gemini_api_key, self.gemini_base_url
        return self.llm_api_key, self.llm_base_url

    def key_setting_for(self, model: str) -> str:
        """The environment variable that holds this model's key, for error messages.

        Worth naming exactly. "Set LLM_API_KEY" is wrong advice for a model mapped to
        another provider, and following it produces an authentication failure rather than
        a fix - so the message has to name the variable the reader actually needs.
        """
        provider = _lookup(self.llm_provider_by_model, model)
        return "GEMINI_API_KEY" if provider == "gemini" else "LLM_API_KEY"

    def _budget_for(self, mapping: str, model: str, default: int) -> int:
        """A per-model token budget, or the global default when unlisted.

        A listed value of 0 is honoured as "do not meter this", not treated as missing -
        that is how a provider with no separate output limit is expressed.
        """
        raw = _lookup(mapping, model)
        if raw is None or raw == "":
            return default
        try:
            return max(0, int(raw))
        except ValueError:
            # A typo in a budget must not stop the server or silently remove pacing;
            # the global default is the safe reading of an unusable one.
            return default

    def tokens_per_minute_for(self, model: str) -> int:
        return self._budget_for(
            self.llm_tokens_per_minute_by_model, model, self.llm_tokens_per_minute
        )

    def tokens_per_day_for(self, model: str) -> int:
        return self._budget_for(
            self.llm_tokens_per_day_by_model, model, self.llm_tokens_per_day
        )

    def output_tokens_per_minute_for(self, model: str) -> int:
        return self._budget_for(
            self.llm_output_tokens_per_minute_by_model,
            model,
            self.llm_output_tokens_per_minute,
        )

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
    chain = config.verification_chain
    if config.screening_model in chain:
        where = (
            "VERIFICATION_MODEL"
            if config.screening_model == config.verification_model
            else "VERIFICATION_MODEL_FALLBACKS"
        )
        raise AgentModelConflict(
            f"SCREENING_MODEL and {where} both contain '{config.screening_model}'. "
            "Agents 3 and 4 must use different models, and that has to hold for every "
            "model Agent 4 may fall back to - not just its first choice. Two agents "
            "sharing one model share its blind spots, so their agreement would no longer "
            "mean the paper was independently confirmed. A fallback breaks this the most "
            "quietly of all: the chain only reaches it once the primary quota is spent, "
            "so the property disappears part-way through a run and every response still "
            f"looks right. Agent 4's chain is currently {chain}. Fix it in backend/.env."
        )
