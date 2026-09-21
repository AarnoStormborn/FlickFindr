# FlickFindr

Love Movies ? Call yourself a Cinephile ? You will love it

Movie discovery + search: structural, semantic (natural-language), and hybrid
search over a movie catalog, an agent-powered query parser, and **the
Concierge** — a chat assistant that searches the catalog with tools and answers
with clickable movie cards.

## Stack

- **Backend** (`backend/`): TypeScript · Fastify · PostgreSQL + pgvector ·
  transformers.js embeddings (all-MiniLM-L6-v2) · **Pi SDK agents** for query
  interpretation + the concierge chat
- **Frontend** (`frontend/`): React 19 · Vite · React Router
- **Infra** (`docker-compose.yml`): postgres+pgvector (host :5433), redis (host :6380)

## Setup

```bash
cp .env.example .env        # dev defaults work out of the box
docker compose up -d        # postgres (:5433) + redis (:6380)
cd backend && npm install && npm run dev   # API → http://localhost:8001
cd frontend && npm install && npm run dev  # UI  → http://localhost:5173
```

After ingesting data, populate embeddings: `cd backend && npm run embeddings`.

The Concierge and agent-side query parsing need a model credential — set one of
`DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY` or `COMMAND_CODE_API_KEY` in `backend/.env`. Without one
the app still works: agent features report "not configured" and search uses the
raw query. See [`backend/README.md`](backend/README.md#agent-mode).

## Deployment (production)

Free, managed stack — see [`deploy/README.md`](deploy/README.md):

- **Frontend** → Vercel (static React build, `VITE_API_URL` set at build time)
- **Backend** → Render free web service (auto-deploy from GitHub, `render.yaml`)
- **Database** → Supabase free tier (Postgres + pgvector; `supabase/schema.sql`)
- **Catalog data** → S3 parquet → Supabase via `tools/load-backend/load.py`

## Docs

| Doc | What's in it |
|---|---|
| [`docs/roadmap.md`](docs/roadmap.md) | Positioning, what's shipped, what's next |
| [`docs/workflow.md`](docs/workflow.md) | Branching model (feature → dev → main) and deploy targets |
| [`docs/runbook.md`](docs/runbook.md) | Rebuilding/verifying a database, and the `npm run check --strict` gate |
| [`docs/FRONTEND_DESIGN_INSPIRATION.md`](docs/FRONTEND_DESIGN_INSPIRATION.md) | Historical design rationale — **not** the current spec |
| [`backend/README.md`](backend/README.md) | API surface, scripts, agent configuration |
| [`pi-ingest/README.md`](pi-ingest/README.md) | Raspberry Pi ingestion + trailer refresh jobs |
| [`deploy/README.md`](deploy/README.md) | Production deployment (Vercel / Render / Supabase) |

## Tests

```bash
cd backend  && npm test              #  98 tests
cd frontend && npm test              # 104 tests

cd backend  && npm run test:coverage # enforced by a threshold ratchet in CI
cd frontend && npm run test:coverage
```

`npm audit` is clean in both packages, and CI runs lint, coverage and build on
every PR and on `dev`/`main` pushes.