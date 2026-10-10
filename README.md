# EvidenceIQ

Systematic Review Screening Assistant: an agentic AI system that automates literature screening for systematic reviews.

A researcher describes their review question. EvidenceIQ turns it into a structured protocol, pulls candidate papers from PubMed, drafts an include/exclude decision for each one, and has a second, independent model check that decision against quoted evidence. **The researcher always makes the final call.** Nothing is included or excluded without them.

Built for SLIIT IT3041.

## How it works

Four agents run behind one FastAPI backend. An orchestrator passes work from one agent to the next.

```
Researcher's question
        │
        ▼
 Agent 1  Criteria       turns free text into a PICO-style protocol (inclusion / exclusion criteria)
        │
        ▼
 Agent 2  Retrieval      builds a safe PubMed query, fetches records, ranks them locally
        │
        ▼
 Agent 3  Screening      drafts INCLUDE / EXCLUDE per paper, with reasons and flags
        │
        ▼
 Agent 4  Verification   independent second opinion: rules + evidence extraction + a different LLM
        │
        ▼
 Researcher approves or overrides each decision
```

- **Agents 3 and 4 never share a model.** Two agents on the same model share its blind spots, so their agreement would mean little. The server refuses to start if `SCREENING_MODEL` matches `VERIFICATION_MODEL` or any of its fallbacks (`check_agent_models()` in [backend/app/core/config.py](backend/app/core/config.py)).
- **Agent 4 never sees Agent 3's decision**, so it cannot simply agree with it. See [backend/app/agents/verification/README.md](backend/app/agents/verification/README.md).
- The orchestrator (`/api/pipeline/*`) calls the other agents over real HTTP and forwards the caller's JWT, so every agent enforces the same ownership checks.

Other features:

- **Paper chat**: ask questions about a single paper. Answers are grounded in quotes checked against the source text.
- **Quick Chat**: upload a PDF and chat with it.
- **Exports**: download screening decisions as CSV or RIS, with a PRISMA flow diagram and a full audit history for each paper.
- **Plans**: Free, plus paid plans through Stripe Checkout. Every plan runs the same screening; paid plans only allow more of it.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, `@supabase/supabase-js` |
| Backend | Python 3.11, FastAPI, Pydantic, SQLAlchemy, psycopg 3, httpx |
| Database and auth | Supabase (Postgres + Auth; JWTs verified against Supabase's JWKS) |
| LLMs | Groq (OpenAI-compatible API) for Agents 1 and 3 and the chats; Gemini as Agent 4's main model, with Groq fallbacks |
| Literature source | NCBI PubMed E-utilities |
| Payments | Stripe Checkout (optional) |
| Hosting | Render (see [render.yaml](render.yaml)) |

## Repository layout

```
EvidenceIQ/
├── backend/
│   ├── app/
│   │   ├── agents/         Agent 3 (screening) and Agent 4 (verification)
│   │   ├── core/           config, database, auth (security.py), middleware, sanitisation
│   │   ├── models/         SQLAlchemy models
│   │   ├── routers/        API endpoints
│   │   ├── schemas/        Pydantic request and response models
│   │   ├── services/       criteria agent, PubMed, ranking, pipeline, LLM client, billing, chats
│   │   └── main.py         app entry point
│   ├── migrations/         SQL files, applied by hand in the Supabase SQL editor
│   ├── postman/            Postman collections for Agent 3, Agent 4 and the pipeline
│   ├── scripts/            seed data and smoke tests against a running server
│   ├── tests/              pytest suite
│   └── .env.example        every backend setting, with notes
├── frontend/
│   └── src/
│       ├── pages/          landing, auth, dashboard, reviews, quick chat, settings, ...
│       ├── components/     shared UI and dashboard widgets
│       ├── context/        auth context
│       └── lib/            API clients and helpers
├── render.yaml             Render blueprint for both services
└── SECURITY.md             security controls, and the test that proves each one
```

## Getting started

### Prerequisites

- Python 3.11
- Node.js 20 or later
- A Supabase project (Postgres and Auth)
- A Groq API key (<https://console.groq.com>) and a Gemini API key (<https://aistudio.google.com/apikey>). The free tiers are enough.
- Optional: an NCBI API key, Stripe test-mode keys

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate    macOS/Linux: source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

cp .env.example .env    # then fill in the values below
uvicorn app.main:app --reload --port 8000
```

The minimum `.env` values to fill in:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string (pooler, `postgresql+psycopg://...`) |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `LLM_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Gemini API key (Agent 4) |
| `CORS_ORIGINS` | `http://localhost:5173` for local development |

Every other setting has a working default and is explained in [backend/.env.example](backend/.env.example): model choices, token budgets, rate limits, request size limits, NCBI and Stripe.

Check that it is running at <http://localhost:8000/api/health>. Interactive API docs are at <http://localhost:8000/docs> (turned off when `ENVIRONMENT=production`).

### 2. Database

Supabase creates the auth tables. Apply the SQL files in [backend/migrations/](backend/migrations/) in date order, using the Supabase SQL editor.

> Supabase Row Level Security does not cover the backend's database connection. Every handler checks ownership itself, so keep doing that in any new endpoint.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env    # set VITE_SUPABASE_ANON_KEY
npm run dev
```

The app runs at <http://localhost:5173>.

| Variable | What it is |
| --- | --- |
| `VITE_API_BASE_URL` | Backend URL, `http://localhost:8000` locally |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public by design) |

## API overview

Every route is under `/api`. All routes except `/` and `/api/health` need a Supabase access token in `Authorization: Bearer <token>`.

| Prefix | Purpose |
| --- | --- |
| `/api/criteria` | Agent 1: submit, clarify, list, update and delete reviews |
| `/api/retrieval/search` | Agent 2: PubMed search and ranking |
| `/api/screen` | Agent 3: screen one paper, a batch, or a stored paper by id |
| `/api/verify` | Agent 4: verify one paper, a batch, or a stored paper by id |
| `/api/pipeline` | Orchestrator: run a single paper, a whole review, or the full chain |
| `/api/reviews` | Review status |
| `/api/papers/{id}` | Paper summary and paper chat |
| `/api/quick-chat` | PDF upload and chat sessions |
| `/api/subscription`, `/api/payments` | Plans and Stripe Checkout |
| `/api/me`, `/api/me/export`, `/api/me/data` | Profile, data export, data erasure |

Ready-made requests are in [backend/postman/](backend/postman/).

## Testing

```bash
cd backend
pytest tests
```

Pass `tests` explicitly. A bare `pytest` also collects `scripts/test_*.py`, which expect a running server and stop the run. The suite stubs out the LLM providers and PubMed, so it makes no real calls. `tests/test_auth_required.py` walks the OpenAPI schema and fails if any non-public route answers without a token. Add new endpoints with that check in mind.

To try a running server end to end with real models, use the scripts in [backend/scripts/](backend/scripts/), for example `python scripts/test_full_chain.py`.

Frontend lint:

```bash
cd frontend
npm run lint
```

## Deployment

[render.yaml](render.yaml) defines both services:

- **evidenceiq-backend**: Python web service running `uvicorn app.main:app`. Set the secrets (`DATABASE_URL`, `LLM_API_KEY`, `NCBI_API_KEY`, the Stripe keys) in the Render dashboard; they are marked `sync: false`.
- **evidenceiq-frontend**: static site built with `npm run build`. It sets a strict Content Security Policy and other security headers.

## Security

[SECURITY.md](SECURITY.md) lists every security control, the finding it closes, where it is in the code and which test proves it. It covers prompt-injection defences, authentication and ownership checks, PubMed query sanitisation, rate limiting, request size limits, security headers and data-subject rights (export and erasure).

Never commit `backend/.env` or any real API key, database password or Stripe secret.

## Contributing

- Branch from `development` and open pull requests into **`development`**, not `main`.
- Schema changes go in a new dated SQL file in `backend/migrations/`.
- Run `pytest tests` before opening a PR.
