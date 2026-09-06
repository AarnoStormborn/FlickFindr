# FlickFindr

Love Movies ? Call yourself a Cinephile ? You will love it

Movie discovery + search: structural, semantic (natural-language), and hybrid
search over a movie catalog, with an agent-powered query parser and chat.

## Stack

- **Backend** (`backend/`): TypeScript · Fastify · PostgreSQL 16 + pgvector ·
  transformers.js embeddings (all-MiniLM-L6-v2) · **Pi SDK agents** for query
  interpretation + chat
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

## Deployment (production)

Free, managed stack — see [`deploy/README.md`](deploy/README.md):

- **Frontend** → Vercel (static React build, `VITE_API_URL` set at build time)
- **Backend** → Render free web service (auto-deploy from GitHub, `render.yaml`)
- **Database** → Supabase free tier (Postgres + pgvector; `supabase/schema.sql`)
- **Catalog data** → S3 parquet → Supabase via `tools/load-backend/load.py`

See `backend/README.md` for the API surface and agent configuration.