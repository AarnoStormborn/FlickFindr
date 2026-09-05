"""One-time backfill: fetch /movie/{id} detail for every TMDB movie that is
missing runtime, and update runtime + gross (revenue). Resumable — re-running
only processes rows where runtime IS NULL. Rate-limit and network safe.

Usage:
    python backfill.py              # fill all missing runtimes (~31k calls)
    python backfill.py --limit 50   # small test batch
    python backfill.py --concurrency 6

Env: TMDB_API_KEY from ../backend/.env; DB creds as in load.py.
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _tmdb_session() -> tuple[str, str]:
    backend_env = _load_env(ROOT / "backend" / ".env")
    key = backend_env.get("TMDB_API_KEY", "")
    if not key:
        sys.exit("TMDB_API_KEY not found in ../backend/.env")
    return key, "https://api.themoviedb.org/3"


def _db_url() -> str:
    backend_env = _load_env(ROOT / "backend" / ".env")
    host = backend_env.get("DB_HOST", "localhost")
    port = backend_env.get("DB_PORT", "5433")
    name = backend_env.get("DB_NAME", "flickfindr")
    user = backend_env.get("DB_USER", "flickfindr")
    pw = backend_env.get("DB_PASSWORD", "flickfindr")
    return f"postgresql://{user}:{pw}@{host}:{port}/{name}"


def _fetch_detail(api_key: str, base: str, tmdb_id: int) -> dict | None:
    import requests

    url = f"{base}/movie/{tmdb_id}"
    params = {"api_key": api_key, "language": "en-US"}
    attempt = 0
    while True:
        try:
            resp = requests.get(url, params=params, timeout=(5, 30))
        except requests.RequestException:
            # Network reset (throttle edge): back off hard and politely.
            attempt += 1
            delay = min(5 * 2 ** max(0, attempt - 1), 60)
            if attempt > 8:
                return None
            time.sleep(delay)
            continue
        if resp.ok:
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504):
            attempt += 1
            delay = min(5 * 2 ** max(0, attempt - 1), 60)
            if attempt > 8:
                return None
            time.sleep(delay)
            continue
        return None  # 404 or other — movie gone; leave null


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=3)
    args = p.parse_args()

    import psycopg

    api_key, base = _tmdb_session()
    db_url = _db_url()
    total_done = 0
    total_filled = 0
    not_found = 0

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            sql = "SELECT tmdb_id FROM movies WHERE tmdb_id IS NOT NULL AND runtime IS NULL"
            if args.limit:
                sql += f" LIMIT {args.limit}"
            cur.execute(sql)
            ids = [r[0] for r in cur.fetchall()]
        if not ids:
            print("No rows need backfill (runtime is set everywhere).")
            return
        print(f"Backfilling {len(ids)} movies (concurrency={args.concurrency})")

        def work(tmdb_id: int) -> tuple[int, int | None, int | None]:
            detail = _fetch_detail(api_key, base, tmdb_id)
            if not detail:
                return tmdb_id, None, None
            runtime = detail.get("runtime")
            revenue = detail.get("revenue")
            return tmdb_id, (int(runtime) if runtime else None), (int(revenue) if revenue and revenue > 0 else None)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {pool.submit(work, tid): tid for tid in ids}
            with conn.cursor() as cur:
                for future in as_completed(futures):
                    tid, runtime, revenue = future.result()
                    total_done += 1
                    if runtime is not None or revenue is not None:
                        cur.execute(
                            "UPDATE movies SET runtime = COALESCE(%s, runtime), gross = COALESCE(%s::text, gross) WHERE tmdb_id = %s",
                            (runtime, str(revenue) if revenue else None, tid),
                        )
                        total_filled += 1
                    elif runtime is None and revenue is None:
                        # genuinely missing on TMDB (404 or no data) — mark so we don't refetch forever
                        cur.execute("UPDATE movies SET runtime = 0 WHERE tmdb_id = %s", (tid,))
                        not_found += 1
                    if total_done % 250 == 0:
                        conn.commit()
                        print(f"  {total_done}/{len(ids)} done ({total_filled} filled)", flush=True)
            conn.commit()
    print(f"Done: {total_done} processed, {total_filled} updated, {not_found} no-data (runtime=0).")


if __name__ == "__main__":
    main()