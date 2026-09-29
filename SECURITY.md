# EvidenceIQ security controls

This document lists the security controls in EvidenceIQ, which finding each one closes, where it lives in the code, and which test proves it. It is organised by the four assessment areas of the IT3041 individual security audit.

All controls below are on branch `security/hardening`. Every one has a regression test in `backend/tests/test_security_hardening.py`, and the full suite (401 tests) passes.

## At a glance

| Area | Before hardening | After |
| --- | --- | --- |
| Prompt injection detection | 3 of 6 realistic payloads flagged; flags then discarded by Agent 3 | 10 of 10 test payloads flagged, 0 of 8 genuine abstract sentences flagged; flags returned, audited and routed to a human |
| Unauthenticated data access | `GET /api/criteria/` returned every review (fixed in `f27c7a1`) | 2 of 36 operations public, both by design (`/`, `/api/health`) |
| PubMed query injection | Field tags, date ranges and brackets executed by PubMed | Stripped; term bracketed; syntax-only search refused; changes reported |
| Rate limiting | None: 20 of 20 requests succeeded | 120/min per client, 20/min on PubMed/LLM routes, `429` + `Retry-After` |
| Oversized requests | Upload buffered fully before the size check | Refused from `Content-Length` before any byte is read (`413`) |
| Security headers | None; `server: uvicorn` exposed | CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `no-store`, HSTS in production; server header removed |
| Data-subject rights | No review deletion, no export, no erasure | `DELETE /api/criteria/{id}`, `GET /api/me/export`, `DELETE /api/me/data` |

## Student 1: prompt injection, jailbreak and prompt leakage

| Control | Where | Proven by |
| --- | --- | --- |
| Injection detector rewritten: overrides, role-play/jailbreak, prompt extraction, text addressed to the model, decision steering, fake protocol blocks, fake conversation turns. Every pattern is phrased as something said *to* a model, so medical prose does not trip it. | `app/core/sanitize.py` | `test_injection_payloads_are_flagged`, `test_ordinary_abstract_wording_is_not_flagged` |
| Zero-width bypass closed: text is checked with invisible characters both removed and turned into spaces. | `sanitize.looks_like_injection` | `test_zero_width_characters_no_longer_hide_an_injection` |
| Fence-breaking neutralised: `</paper>`, `<system>`, `"""` and the other prompt section markers are defanged inside untrusted text and inside protocol fields. | `sanitize.neutralise_fences`, `schemas/protocol.py` | `test_text_cannot_close_its_own_prompt_fence`, `test_protocol_text_cannot_close_the_protocol_fence` |
| Agent 3 no longer discards the sanitiser's flags. They are returned as `flags`, set `needs_human_review`, and are written to the `paper_events` audit trail. | `agents/screening/agent.py`, `services/pipeline.py` | `test_screening_flags_reach_the_caller_instead_of_being_discarded` |
| Criteria Agent: researcher text is fenced in tagged data blocks with a data-not-instructions rule; the model's protocol is validated against the `Protocol` schema before it is saved. | `services/criteria_agent.py` | `test_criteria_agent_*` |
| Agent 4 ignores criteria the model invents. Previously an invented criterion judged FAIL could exclude a paper. | `agents/verification/agent.py` | `test_verification_ignores_criteria_the_model_invented` |
| Prompt-leak filter on both chats: an answer reproducing 12+ consecutive words of the system prompt is replaced with a refusal. | `services/output_guard.py` | `test_chat_answer_reproducing_the_system_prompt_is_replaced` |
| All model output shown to researchers (reasons, issues, evidence, notes, chat answers) is stripped of control characters and length-capped. Unparseable output is no longer echoed. | `sanitize.clean_model_text` | `test_model_text_is_bounded_and_stripped`, `test_unparseable_screening_output_is_not_echoed_to_the_researcher` |

## Student 2: privacy and data leakage

| Control | Where | Proven by |
| --- | --- | --- |
| Rejected tokens logged by failure class and a 12-character fingerprint, never the token; `print()` removed (V-12). | `app/core/security.py` | `test_rejected_tokens_are_logged_without_the_token` |
| JWT now requires `exp`, `sub`, `aud`, `iss`; rejects non-`authenticated` roles (anon/service tokens). | `app/core/security.py` | covered by the auth suite |
| `Cache-Control: no-store` on every `/api` response. | `app/core/middleware.py` | `test_api_responses_are_not_cacheable` |
| Logs record lengths, not content, for dropped chat quotes; user ids in security logs are pseudonymised. | `services/paper_chat.py`, `services/quick_chat.py`, `security.user_fingerprint` | code review |
| Right of access / portability: `GET /api/me/export` returns everything held for the caller. | `services/user_data.py`, `routers/users.py` | `test_export_is_scoped_to_the_caller` |
| Right to erasure: `DELETE /api/me/data` with `{"confirm": "DELETE MY DATA"}` removes every review, paper, event, chat and subscription on the account. | same | `test_erasing_data_requires_the_confirmation_phrase` |
| Delete one review, owner only, same 404 for "not yours" and "not found". | `routers/criteria.py` | `test_a_review_can_only_be_deleted_by_its_owner` |
| Internal URLs and raw connection errors no longer returned to callers when an agent is unreachable. | `services/agent_client.public_error` | `test_unreachable_agent_errors_do_not_expose_internal_urls` |
| Uploaded filenames stripped of paths, control characters and markup before being stored or shown. | `routers/quick_chat._safe_filename` | `test_uploaded_filenames_are_made_safe` |

## Student 3: responsible AI, hallucination and bias

| Control | Where | Proven by |
| --- | --- | --- |
| "Grounded" now requires at least one quote verified verbatim against the source. A model claiming `grounded: true` with no quotes is downgraded. | `services/output_guard.py` | `test_grounded_requires_a_verified_quote` |
| Papers with no abstract (including PubMed's "Abstract not available." placeholder) are still drafted EXCLUDE but marked `needs_human_review` with an explicit flag. Silent exclusion biased reviews against older papers and smaller journals. | `agents/screening/agent.py` | `test_a_paper_without_an_abstract_is_sent_to_a_human` |
| Ranking: whole-word matching (no `metformin` in `metformin-free`); stuffed titles penalised and flagged; recency bonus only for on-topic papers; PubMed's own order kept as `pubmed_rank` and blended in. | `services/ranking_service.py` | `test_ranking_*`, `test_keyword_stuffed_titles_*` |
| Transparency: Agent 3 records which model produced each draft; retrieval returns the exact query executed and anything removed from it. | `schemas/screening.py`, `routers/retrieval.py` | `test_screening_flags_*` |
| Incomplete PubMed records are counted by reason and logged instead of silently skipped. | `services/pubmed_service.parse_pubmed_xml` | `test_non_numeric_pmids_are_dropped` |

## Student 4: information retrieval and API security

| Control | Where | Proven by |
| --- | --- | --- |
| Query injection (V-02): field tags, date ranges, history references and malformed brackets removed; bracket *order* validated so `)` cannot escape the wrapper; term bracketed before filters; a search that is only syntax is refused (422). `NOT` is kept but reported. | `services/pubmed_service.neutralise_query` | `test_field_tags_*`, `test_a_closing_bracket_cannot_escape_the_wrapper`, `test_the_date_filter_always_covers_the_whole_term` |
| Retrieval response reports `executed_query` and `query_warnings`, so every search is reportable (PRISMA). | `routers/retrieval.py` | live check |
| Pagination (V-04): `max_results` caps the whole search; the response returns the page size actually used. | `retrieve_pubmed_papers` | `test_max_results_caps_the_whole_search_not_one_page` |
| Ownership checked before the PubMed call, so another researcher's review id costs no NCBI quota. | `routers/retrieval.py` | `test_retrieval_checks_ownership_before_calling_pubmed` |
| XML with entity declarations refused outright (not left to a library default); non-numeric PMIDs dropped. | `parse_pubmed_xml` | `test_xml_with_entity_declarations_is_refused` |
| NCBI `tool`/`email`/`api_key` sent when configured. | `pubmed_service._ncbi_params` | config |
| Rate limiting (V-05): sliding window per client; tighter bucket for PubMed/LLM routes; `X-Forwarded-For` trusted only behind a proxy, right-most entry only. | `app/core/middleware.py` | `test_requests_past_the_limit_*`, `test_expensive_routes_*`, `test_forwarded_for_*` |
| Body size (V-06): refused from `Content-Length` before reading; chunked bodies counted; uploads read in chunks and stopped at the limit. | `middleware.BodySizeLimitMiddleware`, `quick_chat._read_limited` | `test_oversized_bodies_are_refused_before_they_are_read` |
| Input size limits on every paper, protocol and criteria field. | `schemas/paper.py`, `schemas/protocol.py`, `schemas/review.py` | `test_oversized_fields_are_rejected_by_the_schema` |
| Security headers (V-09) on every response; `server` header removed in deployment. | `middleware.SecurityHeadersMiddleware`, `render.yaml` | `test_security_headers_are_present` |
| API docs off in production (V-10). | `app/main.py`, `core/config.py` | `test_docs_are_off_in_production` |
| CORS limited to the methods and headers the frontend uses. | `app/main.py` | live check |
| Frontend served with a strict CSP (own scripts only; network calls only to the API and Supabase). | `render.yaml` | deploy check |

## Residual risks

These are known and accepted, not fixed:

- **Lexical ranking cannot understand synonyms.** A trial describing "biguanide therapy" still scores 0 for "metformin". Stuffing and substring attacks are closed; the durable fix is ranking by PubMed's MeSH-aware relevance order or a BM25/embedding model.
- **The injection detector is a denylist.** It catches the tested families of wording without false alarms, but a new paraphrase can always exist. The guarantee rests on the layers behind it: prompt fencing, output validation, and Agent 4 re-checking on a different model family.
- **Free-text `AND`/`NOT` still narrow a search.** That is how searches are written. Field-tag targeting is gone, and every `NOT` is reported in `query_warnings`.
- **Rate-limit state is per process.** Correct for the current single-worker deployment. Several workers or hosts would need a shared store such as Redis.
- **Erasure does not remove the Supabase sign-in.** That needs an admin key this service deliberately does not hold; the response tells the user.

## Verify it yourself

```bash
cd backend
./venv/Scripts/python.exe -m pytest tests -q                              # 401 tests
./venv/Scripts/python.exe -m pytest tests/test_security_hardening.py -v   # the security suite
./venv/Scripts/python.exe ../security-assessment/tc05_query_injection_test.py  # live PubMed, now PASS
```

## Deployment settings

Set on Render (already in `render.yaml`): `ENVIRONMENT=production`, `TRUST_PROXY_HEADERS=true`, `ENABLE_API_DOCS=false`, `--no-server-header`. Optional: `NCBI_API_KEY`. All request-level settings are documented in `backend/.env.example`.

## Reporting a vulnerability

Report privately to the project team rather than opening a public issue. Include the endpoint, the request, and what you observed.
