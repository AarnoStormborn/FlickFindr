"""Backfill `movies.runtime` (and `gross`) from TMDB.

One `/movie/{id}` request per film: runtime is not available from `/discover`,
so unlike the language backfill this really is per-film work.

Resumable: `runtime_checked` marks a film TMDB has answered for, so the row is
the checkpoint and re-running picks up where it stopped. A film TMDB has no
runtime for is recorded as *checked* with runtime left NULL — never 0, which
would be indistinguishable from a real 0-minute film and would make it match an
`under N minutes` filter.

Run this from a host that can actually reach TMDB. It aborts after
CONSECUTIVE_FAILURE_LIMIT failures in a row rather than grinding: a host with a
broken route to api.themoviedb.org (an MTU black hole behind a VPN, for example)
fails *after* the TLS handshake, which looks like slow progress rather than an
error, and would otherwise spend minutes per film for days.

Usage:
    python backfill.py                    # every film not yet checked
    python backfill.py --limit 50         # small test batch
    python backfill.py --concurrency 6

Target database: `DATABASE_URL` if set (env var, else the repo-root `.env`),
otherwise DB_* from backend/.env, defaulting to the local docker database. Pass
DATABASE_URL explicitly to backfill production — the default is local, and a
run that silently fills the dev database is how production ended up with no
runtimes at all.

Env: TMDB_API_KEY from backend/.env.
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
    """DATABASE_URL wins, so production can be targeted without editing .env."""
    import os

    explicit = os.environ.get("DATABASE_URL") or _load_env(ROOT / ".env").get("DATABASE_URL", "")
    if explicit:
        return explicit
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
    # Short ladder on purpose. A long one does not fix an unreachable host, it
    # just hides the problem: 8 attempts with a 60s cap is ~5 minutes spent per
    # film, which reads as "slow" rather than "broken".
    while True:
        try:
            resp = requests.get(url, params=params, timeout=(5, 15))
        except requests.RequestException:
            attempt += 1
            if attempt >= MAX_ATTEMPTS:
                return None
            time.sleep(2 ** attempt)
            continue
        if resp.ok:
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504):
            attempt += 1
            if attempt >= MAX_ATTEMPTS:
                return None
            time.sleep(2 ** attempt)
            continue
        return None  # 404 or other — movie gone; leave unchecked


# Consecutive failures before giving up. One dead film is normal (a 404); a run
# of them means this host cannot reach TMDB, and continuing would waste hours.
CONSECUTIVE_FAILURE_LIMIT = 25
MAX_ATTEMPTS = 4


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=3)
    args = p.parse_args()

    import psycopg

    api_key, base = _tmdb_session()
    db_url = _db_url()
    started = time.monotonic()
    total_done = 0
    total_filled = 0
    no_data = 0
    failed = 0
    aborted = False

    safe_url = db_url.split("@")[-1]
    print(f"Target database: {safe_url}")

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            # Most-voted first, so an interrupted run has covered the films people
            # actually open rather than an arbitrary slice.
            sql = (
                "SELECT tmdb_id FROM movies "
                "WHERE tmdb_id IS NOT NULL AND runtime_checked = false "
                "ORDER BY NULLIF(votes, '')::int DESC NULLS LAST, id ASC"
            )
            if args.limit:
                sql += f" LIMIT {args.limit}"
            cur.execute(sql)
            ids = [r[0] for r in cur.fetchall()]
        if not ids:
            print("Nothing to do (every film has been checked for a runtime).")
            return
        print(f"Checking {len(ids)} movies (concurrency={args.concurrency})")

        def work(tmdb_id: int) -> tuple[int, int | None, int | None, bool]:
            detail = _fetch_detail(api_key, base, tmdb_id)
            if detail is None:
                # Unreachable/404 after retries: leave unchecked so a later run
                # retries rather than recording a wrong answer as final.
                return tmdb_id, None, None, False
            runtime = detail.get("runtime")
            revenue = detail.get("revenue")
            return (
                tmdb_id,
                int(runtime) if runtime else None,
                int(revenue) if revenue and revenue > 0 else None,
                True,
            )

        pool = ThreadPoolExecutor(max_workers=args.concurrency)
        consecutive_failures = 0
        try:
            futures = {pool.submit(work, tid): tid for tid in ids}
            with conn.cursor() as cur:
                for future in as_completed(futures):
                    tid, runtime, revenue, ok = future.result()
                    if not ok:
                        failed += 1
                        consecutive_failures += 1
                        if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
                            print(
                                f"\nABORTING: {consecutive_failures} films in a row were unreachable."
                                "\nTMDB is not answering from this host, so continuing would only"
                                " burn time. Check connectivity (a TLS handshake that succeeds and"
                                " then resets usually means an MTU/VPN problem, not a bad key):"
                                f"\n  curl -sv -o /dev/null -m 10 '{base}/movie/550?api_key=<key>'",
                                flush=True,
                            )
                            for pending in futures:
                                pending.cancel()
                            aborted = True
                            break
                        continue
                    consecutive_failures = 0
                    total_done += 1
                    # Checked either way; the value is only set when TMDB had one.
                    cur.execute(
                        "UPDATE movies SET runtime = COALESCE(%s, runtime), "
                        "gross = COALESCE(%s::text, gross), runtime_checked = true "
                        "WHERE tmdb_id = %s",
                        (runtime, str(revenue) if revenue else None, tid),
                    )
                    if runtime is not None or revenue is not None:
                        total_filled += 1
                    else:
                        no_data += 1
                    if total_done % 250 == 0:
                        conn.commit()
                        rate = total_done / max(time.monotonic() - started, 0.001)
                        print(
                            f"  {total_done}/{len(ids)} done ({total_filled} filled, "
                            f"{no_data} no-data) — {rate:.1f} films/s",
                            flush=True,
                        )
                conn.commit()
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    elapsed = time.monotonic() - started
    rate = total_done / elapsed if elapsed else 0
    print(
        f"Done: {total_done} checked, {total_filled} updated, "
        f"{no_data} with no runtime on TMDB, {failed} unreachable "
        f"({elapsed:.0f}s, {rate:.1f} films/s)"
    )
    if aborted:
        remaining = len(ids) - total_done
        print(f"Stopped early with ~{remaining} films still unchecked; re-run to resume.")
        sys.exit(1)


if __name__ == "__main__":
    main()