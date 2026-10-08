# Viva notes (not part of the submission)


The viva is worth 50 marks — equal to the report. The examiner will ask *why*, not *what*.
Prepare to defend every number in §8.

### A.1 On methodology

**Q: Describe your testing methodology and why you chose it.**
Grey-box: full source access plus live black-box interaction, structured on OWASP API Top 10,
OWASP LLM Top 10, NIST AI RMF and MITRE ATLAS, executed in six phases (§4.2). I chose
grey-box because the two approaches find different classes of defect here. Black-box found
V-01 in minutes but could never explain V-03 — I would have seen odd ordering and blamed
PubMed. Source review found the ranking weakness immediately but could not produce the 26×
result-count expansion that makes V-02 credible. Neither alone produces a finding that is
both explained and evidenced.

**Q: How did you decide what to test, given your specialization?**
I mapped the eight evaluation areas in the brief to the ten-stage retrieval data flow in
§3.2, then asked three questions of each stage: what does it trust, what does it validate,
and what happens when the input is hostile rather than merely malformed. That produced 20
test cases with every brief area covered at least twice.

**Q: Why are some tests offline and some live?**
Determinism and reproducibility. TC-02, TC-03, TC-10 and the XML tests import the real
production functions with no network, database or API keys, so the marker can re-run them and
get byte-identical output. Live testing was reserved for behaviour that only exists in the
running system — authentication, CORS, rate limiting — and for TC-05, where the PubMed impact
had to be real to be credible.

### A.2 On why attacks succeeded or failed

**Q: Why did the prompt injection in TC-08 fail?**
Four layers, and it is worth naming all four because no single one is sufficient. First, the
system prompt explicitly names the attack and gives examples to disregard. Second, the
abstract is fenced in `"""` delimiters inside a labelled section, so it is structurally
separated from the protocol. Third, the output is constrained to a two-key JSON object and
`_parse_llm_output()` validates `decision` against an enum — an unrecognised value degrades
to EXCLUDE rather than propagating. Fourth, Agent 4 re-verifies on a different model *family*,
and the server refuses to start if the two ever share a model. An injection would have to
defeat two independent models to change a stored decision.

**Q: Then why is V-07 still a finding?**
Because the deterministic half of that defence measurably under-delivers. Three of six
semantically identical payloads passed the sanitiser unflagged. Where no flag is raised, the
human reviewer gets no warning — so the probabilistic layer is load-bearing alone, and an
instruction to a language model is not an access control. The finding is about residual risk
and about the gap between apparent and actual coverage, not about a demonstrated bypass.

**Q: Why did the `alg:none` JWT attack fail?**
`jwt.decode()` is called with an explicit `algorithms=["ES256","RS256"]` allowlist. PyJWT
rejects any token whose header algorithm is outside that list before signature verification,
which blocks both `alg:none` and the HS256-confusion variant. Audience and issuer are also
pinned, and the key comes from the live Supabase JWKS, so a self-signed token fails on
signature regardless.

**Q: Why did the query injection succeed?**
Operator precedence. `build_pubmed_query()` appends `AND <dates>[Date - Publication]` to an
unparenthesised user term, and PubMed binds `AND` tighter than `OR`. So
`diabetes OR 1:2100[dp] OR cancer AND 2020:2024[dp]` evaluates as
`diabetes OR 1:2100[dp] OR (cancer AND 2020:2024[dp])` — the date filter constrains only the
last clause. One pair of parentheses fixes it.

### A.3 On risk ratings — expect to be pushed hard here

**Q: Justify Critical for V-01.**
Three cumulative factors. Zero preconditions — no account, no token, no skill, discoverable
through the publicly exposed `/docs`. Complete disclosure — 63 of 63 reviews, 37,300 bytes,
including every protocol. And attack enablement — it publishes every `review_id`, which
defeats UUID unguessability for all 25 correctly-authorised endpoints. Any one factor alone
is High; together they are a total credential-free confidentiality failure of the system's
most sensitive asset.

**Q: Isn't V-01 just a development database with one user?**
The instance is, the vulnerability is not. The query is
`db.query(Review).order_by(...).all()` with no `WHERE` clause. It returns whatever is in the
table. In a multi-user deployment it returns every researcher's reviews, and the same code is
what `render.yaml` deploys to production.

**Q: Why is V-03 High when it is "only" a ranking quality issue?**
Because ranking determines inclusion. At `page_size=10`, "the first page" *is* the screened
set, so guaranteeing rank 1 guarantees the paper reaches Agents 3 and 4. A genuinely relevant
RCT scored 0.0 and ranked last while an irrelevant decoy scored 1.0 and ranked first — in a
system that produces evidence for medical decision-making. It is Medium likelihood, not High,
only because it requires the adversary to publish an indexed paper.

**Q: Why not rate V-05 higher, given it enables bulk exfiltration?**
On its own the consequence is degradation and cost, not data loss — Medium impact. I flagged
in §8.3 that it is a direct multiplier on V-01 and V-02, so its effective combined risk is
higher than its standalone rating. I chose not to inflate the standalone rating for a
dependency, because that would double-count V-01's severity.

**Q: Why is V-07 Medium when the attack failed?**
The rating reflects residual risk from a measured gap, not a successful exploit. If I rated
it on the test outcome alone it would be Informational, which would misrepresent the fact
that the deterministic layer misses half of the realistic payloads.

### A.4 On mitigations

**Q: What is the single highest-value fix?**
M-01. Two functions, one added dependency, one added filter — it eliminates the only Critical
finding. The structural part matters more than the fix itself: making the router
authenticated by default, so a new handler must opt *out*, plus the OpenAPI-driven regression
test asserting every non-public operation returns 401.

**Q: Why remove the custom ranking function rather than improve it?**
Because the system already asks PubMed for `sort=relevance`, which applies NCBI's tuned
ranking over MeSH-expanded terms — and then throws that ordering away and replaces it with
substring overlap. The pipeline performs strictly worse than if the step were deleted. If
local re-ranking is genuinely wanted, BM25 is the right baseline: IDF fixes the unweighted
terms, `k1` saturation fixes keyword stuffing, and `b` length normalisation fixes the
short-title bias — each parameter maps to one of the three defects I demonstrated.

**Q: Would input validation alone fix V-02?**
It would close the demonstrated attack, but parenthesising the term is the more robust fix
because it corrects the precedence bug rather than blocking one route to it. I recommend
both, plus capturing `querytranslation`, so what PubMed actually executed is recorded and not
assumed.

### A.5 On Responsible AI implications

**Q: What are the Responsible AI implications of your findings?**

- **Transparency** — V-02, V-04 and V-11 mean the researcher cannot know what search was
  actually performed. The UI shows filters as applied that were not applied. A system whose
  users cannot see what it did cannot be meaningfully overseen.
- **Accountability** — V-11 means there is no audit trail capable of reconstructing how a
  corpus was assembled, so neither V-02 nor V-03 is detectable after the fact.
- **Fairness and bias** — V-03 systematically favours keyword-dense recent titles over
  substantive older studies using standard clinical terminology. In medical evidence
  synthesis that is a structural bias toward a particular kind of literature, and it operates
  invisibly.
- **Reliability and safety** — V-08 produces systematic false negatives with no visible
  trace. A missed eligible study in a clinical systematic review is a patient-safety issue.
- **Human oversight** — the most important implication. EvidenceIQ's human-confirmation step
  is a genuine strength against a bad model decision, and provides **no protection at all**
  against a corrupted corpus, because a reviewer cannot audit papers they were never shown.
  Retrieval integrity has to be guaranteed by the system; it cannot be delegated to the human.
- **Privacy** — V-01 discloses unpublished research protocols, which is both a GDPR Art. 32
  matter and a research-ethics one, since pre-registration exists precisely to establish that
  criteria were fixed before the evidence was seen.

### A.6 Questions to expect on the wider architecture

Be ready to explain, even though they are other students' specializations:

- The four-agent topology and why Agents 3 and 4 must use different model *families*
  (shared training data means shared blind spots, so agreement between them would stop being
  evidence — and `check_agent_models()` enforces this at startup rather than letting the
  property vanish silently mid-run).
- Why agents communicate over HTTP rather than in-process calls (one contract per agent, so
  an internal caller cannot bypass validation, auth or error handling; and the JWT is
  forwarded on every hop so the downstream agent authorises the original researcher, not a
  service account).
- Why Supabase RLS does not protect the backend's database connection, and what that implies
  for every handler.
- The token-bucket pacer's purpose (protecting per-model vendor quota) and why it is **not**
  API rate limiting (V-05).

---

