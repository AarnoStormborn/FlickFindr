# FlickFindr V1 — Deployment Guide (single $0 VPS)

One always-on box runs the whole stack with Docker Compose + Caddy (auto-HTTPS).
Target: Oracle Cloud **Always Free** ARM VM (~$0/mo). Everything is hobby-grade.

```
Internet -> Caddy (:80/:443, auto TLS)
              ├── frontend (nginx static)
              └── /search/* /flicks/* /chat /config.js -> backend (Fastify :8000)
backend -> postgres (pgvector) + redis (both private network)
```

## 1. Create the VPS (Oracle Always Free)

1. Sign up at cloud.oracle.com (needs a card for identity; ARM free tier does not bill).
2. Create a **VM.Standard.A1.Flex** instance: 4 OCPU / 24 GB RAM, Ubuntu 22.04/24.04 (or Debian).
   - Add your **SSH public key** during creation.
3. In VCN security list, open **80/tcp** and **443/tcp** (SSH 22 is default-open).
4. Optionally give the instance a **public IP reservation** (static).

> If Oracle signup is painful, a Hetzner CX22 (~€4/mo) works identically.

## 2. One-time box setup

```bash
ssh ubuntu@<VPS_IP>

# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then re-login
docker compose version          # sanity

# Project checkout (used by CI deploys)
sudo mkdir -p /opt/flickfindr && sudo chown $USER:$USER /opt/flickfindr
cd /opt/flickfindr
git clone git@github.com:<you>/FlickFindr.git .   # or https clone
```

## 3. Environment (once)

```bash
cd /opt/flickfindr/deploy
cp .env.prod.example .env
nano .env    # set: APP_DOMAIN, APP_URL, POSTGRES_PASSWORD, AGENT_ENABLED, PI_MODEL, TMDB_API_KEY
```

Key vars:

| Var | Notes |
|---|---|
| `APP_DOMAIN` | Your real domain, e.g. `flickfindr.example.com` |
| `POSTGRES_PASSWORD` | Strong random value |
| `AGENT_ENABLED` | `true` = agent search (small LLM cost/search), `false` = free plain search |
| `PI_MODEL` | Cheap model id for the agent (e.g. a sub-backed small model). Empty = first available |
| `CORS_ORIGINS` | Auto-set from `APP_URL` |

Point your domain's **A record** at the VPS IP (Caddy then gets certs automatically).

## 4. First deploy (manual, then CI takes over)

```bash
cd /opt/flickfindr
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps
curl -s https://$APP_DOMAIN/                # frontend
curl -s https://$APP_DOMAIN/search/stats    # API (no auth, public — fine for hobby)
```

The backend container pre-warms the embedding model on first start (downloads
~90 MB once into the `hfcache` volume), then boots.

## 5. Load the catalog (S3 -> prod Postgres)

Run once from anywhere with AWS creds + network to the box, OR port-forward:

```bash
# from your laptop, forward the prod DB port:
ssh -L 5433:localhost:5433 ubuntu@<VPS_IP>
# then (tools/load-backend) pointing DB_PORT=5433 at the tunnel:
DB_PORT=5433 python load.py
```

(Prod Postgres is only on the internal network — the tunnel keeps it private.)

## 6. CI deploys (after the box is proven)

Add GitHub repo secrets:
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`
- `VPS_SSH_KEY` — a deploy key for the box (or your personal key)

Push to `main` → `.github/workflows/deploy.yml` verifies then SSHs in,
`git reset --hard`, and `docker compose up -d --build`. Rollback = push an
older commit.

## 7. Day-2 notes

- **Updates:** `docker compose -f deploy/docker-compose.prod.yml pull` + `up -d`
  after a deploy, plus periodic `apt upgrade` on the box.
- **Backups:** `pg_dump` the `pgdata` volume regularly (cron or a script);
  the S3 parquet files are your archival source of truth regardless.
- **Cheapest agent model:** set `PI_MODEL` to your sub's cheapest model
  (backend already falls back to first-available when empty).
- **Cold-start:** none (always-on box). Watch the box's 1 OCPU idle usage is fine.
