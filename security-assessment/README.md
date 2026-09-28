# IT3041 — Individual AI Security Audit (Student 4)

## Information Retrieval and Security Assessment — EvidenceIQ

Everything needed to run the assessment, capture the evidence, and submit the report.

---

## What is in this folder

| File | What it is | What you do with it |
|---|---|---|
| **`EvidenceIQ-IR-Security-Assessment.pdf`** | **The submission document** — 88 pages, A4, cover page, everything below rendered and paginated | Submit this |
| `EvidenceIQ-IR-Security-Assessment.md` | The editable source — every section the brief asks for, 20 test cases, 12 vulnerabilities, risk matrix, mitigations, reflection, viva prep | Edit this, then re-run `build_pdf.py` |
| `build_pdf.py` | Rebuilds the PDF from the Markdown via headless Edge/Chrome | Run after any edit so the PDF stays in step |
| **`probe_ir_pipeline.py`** | Offline evidence harness — imports the real production functions, no network or keys needed | Run it, screenshot the output (7 probes → 6 test cases) |
| **`EvidenceIQ-Security-Tests.postman_collection.json`** | 25 Postman requests covering every live HTTP test case | Import, set variables, run, screenshot |
| **`evidence/`** | Where your screenshots go | Name files exactly as Appendix B of the report specifies |

---

## Run it in five steps

### 1. Start the backend

```bash
cd d:/SliitProject/IWRA/EvidenceIQ/backend
./venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Check it: `curl http://127.0.0.1:8000/api/health` → `{"status":"ok"}`

### 2. Run the offline probes

In a second terminal:

```bash
cd d:/SliitProject/IWRA/EvidenceIQ/backend
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe ../security-assessment/probe_ir_pipeline.py
```

Add `--live` to also validate the PubMed query-injection impact against the real API
(2 requests, well inside NCBI's limits):

```bash
PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe ../security-assessment/probe_ir_pipeline.py --live
```

Screenshot each of the seven probe sections → `EV-02`, `EV-03`, `EV-04`, `EV-05a`,
`EV-10`, `EV-12`, `EV-13`.

### 3. Demonstrate the Critical finding

No setup, no credentials, no tools:

```bash
curl -s -o /dev/null -w "HTTP %{http_code} (%{size_download} bytes)\n" \
  http://127.0.0.1:8000/api/criteria/
```

Expected: `HTTP 200 (37300 bytes)` — every review in the database, returned to an
unauthenticated caller. Also open `http://127.0.0.1:8000/api/criteria/` in a browser with
no session. **Blur the response content before screenshotting** → `EV-14a`, `EV-14b`.

### 4. Run the Postman collection

1. Import `EvidenceIQ-Security-Tests.postman_collection.json`.
2. Collection → **Variables** tab, fill in:
   - `supabaseAnonKey` — from `render.yaml` → `VITE_SUPABASE_ANON_KEY`
   - `email`, `password` — your EvidenceIQ account
   - `reviewId` — a review UUID you own (TC-14 prints the IDs, or use the app)
3. Run **`00 - Login (capture JWT)`** first. It stores `{{accessToken}}` automatically.
4. Work through the folders in order. Each request's **Description** tab explains what it
   tests, what to expect, and which evidence file it produces. Several print analysis to the
   Postman **Console** (`Ctrl+Alt+C`) — screenshot that too.

For TC-19 (rate limiting), use the **Collection Runner** on that single request with
Iterations = 20, Delay = 0. Keep it to 20 — this is a proof, not a denial-of-service.

### 5. Assemble the report and rebuild the PDF

1. Open `EvidenceIQ-IR-Security-Assessment.md`, fill in the `_(fill in)_` fields at the top
   (name, ID, group, date). These flow onto the PDF cover page automatically.
2. Insert each screenshot under the matching test case's **Evidence** line:
   `![EV-05b](evidence/EV-05b-pubmed-count-comparison.png)`
3. Check every redaction in the box at the end of Appendix B.
4. Rebuild the PDF:

```bash
cd d:/SliitProject/IWRA/EvidenceIQ/security-assessment
../backend/venv/Scripts/python.exe build_pdf.py
```

Then submit `EvidenceIQ-IR-Security-Assessment.pdf`.

> **If `build_pdf.py` says the `markdown` package is missing**, install it to a local
> folder so the project's virtual environment stays untouched:
>
> ```bash
> ../backend/venv/Scripts/python.exe -m pip install --target .pylibs markdown pymdown-extensions
> ```
>
> The script picks up `.pylibs` automatically on the next run.

> **Alternatives** if you would rather not use the script: Pandoc
> (`pandoc EvidenceIQ-IR-Security-Assessment.md -o report.pdf`), or paste the Markdown into
> Typora / VS Code + Markdown PDF / Word 2021+.

---

## ⚠️ Before you submit — redaction checklist

| Item | Action |
|---|---|
| `DATABASE_URL` password | **Never** appears anywhere. Not in screenshots, not in the report. |
| `LLM_API_KEY`, `GEMINI_API_KEY` | Same — blur or crop out of every terminal screenshot. |
| Your JWT / `access_token` | Blur in every Postman screenshot. It is a working credential. |
| Review content in `EV-14b` | Blur the body. The finding is the **HTTP 200 and the byte count**, not the text. Annotate *"63 records returned, redacted."* |
| Exported Postman collection | Clear `password` and `accessToken` before exporting. |
| Supabase anon key | Public by design — safe to leave, but blurring costs nothing. |

---

## What the assessment found

**20 test cases — 13 FAIL, 7 PASS — 12 vulnerabilities, 7 controls verified effective.**

| ID | Finding | Severity |
|---|---|---|
| V-01 | Unauthenticated disclosure of all 63 review protocols; IDOR on `/api/criteria/` | 🔴 **Critical** |
| V-02 | PubMed query injection — date filter bypassed, scope expanded 26× (294,565 → 7,802,778) | 🟠 High |
| V-03 | Ranking invertible by keyword stuffing — relevant RCT scored 0.0, decoy scored 1.0 | 🟠 High |
| V-04 | `max_results` bounds one page, not the corpus; `page_size` silently overridden | 🟡 Medium |
| V-05 | No request-level rate limiting — 20/20 requests returned 200 | 🟡 Medium |
| V-06 | Upload size checked after the full body is buffered into memory | 🟡 Medium |
| V-07 | Injection denylist misses the injection flag on 4 of 6 realistic payloads — 3 carry no flag at all | 🟡 Medium |
| V-08 | Records silently dropped; abstract-less papers auto-EXCLUDEd | 🟡 Medium |
| V-09 | No security headers | 🔵 Low |
| V-10 | `/docs`, `/redoc`, `/openapi.json` publicly exposed | 🔵 Low |
| V-11 | No provenance record — the search is not reproducible | ⚪ Info |
| V-12 | Auth failures logged via `print()` | 🔵 Low |

**Controls that held:** JWT validation (`alg:none` rejected), CORS allowlist,
parameterised SQL, ownership enforced in SQL on the write path, XML entity attacks
rejected, layered prompt-injection defence, enforced Agent 3/4 model independence.

---

## Note for the project team

The findings here are about the **deployed code**, not about anyone's competence — 26 of 29
endpoints enforce authentication correctly, and the security architecture (cross-model
verification, refuse-to-start model separation, manual ownership checks compensating for
RLS not covering the backend connection) is well reasoned.

**V-01 is worth fixing regardless of the assignment.** It is two functions in
`backend/app/routers/criteria.py` missing `Depends(get_current_user)` and an owner filter;
the docstring says *"Filtering by logged-in user comes later with auth."* Mitigation M-01 in
the report has the exact patch, plus a regression test that would stop it recurring.

---

*Testing was performed against a local development instance of the author's own project
group's system, for an authorised academic security assessment. No third-party system was
attacked. PubMed queries stayed within normal public usage limits.*
