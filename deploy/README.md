# FlickFindr — Deployment Guide (Render + Supabase, ~$0/mo)

Cheap, managed, zero-ops deployment:

- **Frontend** → Vercel (free): static React build, CDN, PR previews.
- **Backend (Fastify API)** → Render free web service (auto-deploys from GitHub).
- **Database (Postgres + pgvector)** → Supabase free tier.
- **Data archive** → AWS S3 (from the Pi-ingest pipeline), loaded into Supabase once.

```
Browser
 ├─ https://<vercel-app>.vercel.app   → Vercel (React static)
 └─ API calls (VITE_API_URL)          → https://<render-service>.onrender.com
                                          → Fastify → Supabase (Postgres+pgvector)
```

## 1. Supabase (database)

1. Create a free project at supabase.com.
2. In **SQL Editor**, run the contents of `supabase/schema.sql`
   (enables `vector`, creates `movies`, adds an HNSW index).
   *Or* from `backend/`: `DATABASE_URL=<conn> npm run init:db`.
3. Copy the **connection string** (Project Settings → Database → Connection
   string → URI). This is your `DATABASE_URL`.

> Free tier: 500 MB (our ~30k-row catalog fits comfortably), pauses after 1
> week idle (a weekly visit keeps it alive).

## 2. Render (backend)

1. Push this repo to GitHub.
2. In Render → **New → Blueprint** → select the repo → it reads `render.yaml`.
   (Or: New → Web Service → root dir `backend`, runtime Node, build
   `npm ci && npm run build`, start `node dist/index.js`, plan Free.)
3. In the service **Environment**, set:
   - `DATABASE_URL` — your Supabase connection string
   - `CORS_ORIGINS` — your Vercel app URL (e.g. `https://flickfindr.vercel.app`)
   - `AGENT_ENABLED` — `true` (agent search; small LLM cost) or `false`
   - `COMMAND_CODE_API_KEY` / `GROQ_API_KEY` / `DEEPSEEK_API_KEY` — enables the
     concierge and agent query parsing. Any one is enough; without a key the
     concierge reports "not configured" and search uses the raw query.
   - `PI_MODEL` — optional: pin one model as `provider/id`. Empty is fine: the
     agent works through an ordered preference list (`AGENT_MODEL_FALLBACKS`)
     and finally the cheapest authenticated model. It deliberately does *not*
     fall back to "first available" — that once resolved a ~$50/M flagship.
   - `RATE_LIMIT_MAX` / `CHAT_RATE_LIMIT_MAX` — optional per-IP ceilings (default
     120/min and 8/min). The API is public and /chat costs money per turn.
   - `TMDB_API_KEY` — optional (only if ingest runs here)
4. Deploy. Render auto-deploys on every push to `main` (backend changes).

> Free tier spins down after 15 min idle → the first request after idle takes
> ~30–60s. **Do not run a keep-alive pinger.** A 24/7 ping burns ~744 of the
> 750 free instance-hours each month, and exhausting that suspends *every* free
> service until the cycle resets. The cold start is instead covered in the UI by
> rotating loading quips (see `docs/roadmap.md`), at zero server cost. The
> backend also pre-warms its embedding model in the background on boot, so warm
> requests are fast.

## 3. Vercel (frontend)

1. In Vercel: **Add New Project** → import repo → **Root Directory: `frontend`**.
   (Framework auto-detects Vite.)
2. Environment variable (build time): `VITE_API_URL` = your Render URL
   (e.g. `https://flickfindr-backend.onrender.com`).
3. Deploy. Auto-deploys on frontend pushes; PRs get previews.

> `VITE_API_URL` is baked in at build time. Changing it = redeploy.

## 4. Load the catalog (S3 parquet → Supabase)

From your laptop (or anywhere with AWS creds + the repo):

```bash
cd tools/load-backend
pip install -r requirements.txt          # first time (venv)
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
export DATABASE_URL="<supabase-connection-string>"
python load.py                            # streams S3 parquet → movies table
```

Then generate embeddings for the new rows (plots → `plot_embedding`):

```bash
cd backend
DATABASE_URL="<supabase-connection-string>" npm run embeddings
```

> Supabase connection strings are usually **pooled** (`:6543`) — use the
> **direct** connection (`:5432`) for one-shot loaders/`psql`, and the pooled
> one for the app if needed. TLS is required; both tools use it.

## 5. Day-2 notes

- **Cold starts:** keep Render warm with a free pinger, or pay ~$7/mo to
  disable spin-down (not needed for hobby).
- **Supabase pause:** free projects pause after 1 week idle; visiting weekly
  (or a cron hitting a Supabase function) prevents it.
- **Backups:** Supabase free has no PITR — the S3 parquet files remain your
  archival source of truth; re-running the load step rebuilds the DB anytime.
- **Agent cost:** free tiers are fine for a hobby app but are throttled and
   quota-capped (and DeepSeek needs a funded balance). A cheap paid model —
   `deepseek-v4-flash` at ~$0.14/$0.28 per M tokens — is a few dollars per
   thousand turns and far more predictable.
- **Scale later:** upgrade Render/Supabase tiers if the app grows; no code
  changes needed.
