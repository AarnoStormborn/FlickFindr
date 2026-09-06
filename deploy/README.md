# FlickFindr V1 — Deployment Guide (hybrid: Vercel + single $0 VPS)

**Frontend** → Vercel (free tier: CDN, auto previews per PR, no server to run).
**Backend + Postgres + Redis** → one always-on Oracle **Always Free** ARM VM.
The Vercel app calls the API over HTTPS (Caddy auto-TLS on the VPS).

```
Browser
  ├── https://<vercel-app>.vercel.app  -> Vercel (React static)
  └── API calls (VITE_API_URL)  ->  https://api.<domain>  -> Caddy -> backend:8000
VPS (docker compose): postgres(pgvector) + redis + backend + caddy
```

## Part A — Backend on the VPS

### 1. Create the VM (Oracle Always Free)

1. Sign up at cloud.oracle.com (card for identity; ARM free tier doesn't bill).
2. Create a **VM.Standard.A1.Flex**: 4 OCPU / 24 GB RAM, Ubuntu 22.04/24.04.
   - Add your **SSH public key** during creation.
3. In the VCN security list open **80/tcp** and **443/tcp**.
4. Reserve a static **public IP** (optional but recommended).

> If Oracle signup is painful, Hetzner CX22 (~€4/mo) works identically.

### 2. One-time box setup

```bash
ssh ubuntu@<VPS_IP>
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER          # re-login after
docker compose version

sudo mkdir -p /opt/flickfindr && sudo chown $USER:$USER /opt/flickfindr
cd /opt/flickfindr
git clone <repo> .
```

### 3. Environment (once)

```bash
cd /opt/flickfindr/deploy
cp .env.prod.example .env
nano .env    # set: API_DOMAIN, CORS_ORIGINS, POSTGRES_PASSWORD, PI_MODEL, TMDB_API_KEY
```

Key vars:

| Var | Notes |
|---|---|
| `API_DOMAIN` | The API host, e.g. `api.flickfindr.example.com` |
| `CORS_ORIGINS` | Your Vercel app URL(s) — the browser origin(s) allowed to call the API |
| `POSTGRES_PASSWORD` | Strong random value |
| `AGENT_ENABLED` | `true` = agent search (small LLM cost/search), `false` = free plain search |
| `PI_MODEL` | Cheap model id for the agent (empty = first available) |

Point `api.<domain>` (an **A record**) at the VPS IP → Caddy issues certs automatically.

### 4. First deploy

```bash
cd /opt/flickfindr
docker compose -f deploy/docker-compose.prod.yml up -d --build
curl -s https://api.<domain>/search/stats     # expect JSON
```

Backend pre-warms the embedding model on first boot (~90 MB into `hfcache`).

### 5. Load the catalog (S3 -> prod Postgres)

```bash
# from your laptop, tunnel to the box:
ssh -L 5433:localhost:5433 ubuntu@<VPS_IP>
cd tools/load-backend
DB_PORT=5433 python load.py                 # streams S3 parquet -> prod DB
```

### 6. CI deploys (after the box is proven)

GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, `VPS_SSH_KEY`.
Push to `main` (when backend/deploy files change) → `.github/workflows/deploy.yml`
verifies then SSHs in: `git reset --hard`, `docker compose up -d --build`.

## Part B — Frontend on Vercel

1. Push the repo to GitHub (done).
2. In Vercel: **Add New Project** → import the repo → **Root Directory: `frontend`**.
   - Framework auto-detected: **Vite**.
3. Set the env var for the build:
   - `VITE_API_URL` = `https://api.<domain>` (the Caddy API URL)
4. Deploy. Every push to `main` (frontend changes) auto-deploys; PRs get preview URLs.

> The frontend build needs the API URL at **build time** (`import.meta.env.VITE_API_URL`).
> If you ever want a runtime override, the client also reads `window.__FLICKFINDR_API__`.

## Day-2 notes

- **Backups:** `pg_dump` the `pgdata` volume regularly; S3 parquet files remain the archival source of truth.
- **Model:** set `PI_MODEL` in `deploy/.env` to your sub's cheapest model; restart backend.
- **Region/CORS:** if you add a custom domain on Vercel, append it to `CORS_ORIGINS` in `deploy/.env` and redeploy the API.
