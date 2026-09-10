"""Trailer precompute job — runs on the Pi.

Reads the movie catalog (tmdb_ids) from the S3 parquet files, fetches a
YouTube trailer key per movie from TMDB, and writes the results back to S3 as
a `trailers` parquet (later loaded into the app DB by tools/load-backend).

Resume-safe: per-movie results are recorded in the same SQLite ledger used by
pi-ingest, so interrupted runs continue (only unfinished tmdb_ids refetch).
A TMDB network failure raises and is NOT recorded — the movie stays pending.

Usage (from pi-ingest/):
    TMDB_API_KEY=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
      S3_BUCKET=... python -m ingest.trailers
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
import pyarrow as pa
import pyarrow.parquet as pq

from .db import Store
from .s3upload import make_s3_client, upload_parquet
from .tmdb import TmdbClient, TmdbError

log = logging.getLogger("ingest.trailers")

# Output: one parquet with (tmdb_id, trailer_key). Upserted into the app DB.
SCHEMA = pa.schema(
    [
        ("tmdb_id", pa.int64()),
        ("trailer_key", pa.string()),
        ("source", pa.string()),
        ("fetched_at", pa.timestamp("ms", tz="UTC")),
    ]
)

CONCURRENCY = 4  # Pi-friendly


def _load_env() -> None:
    if os.path.exists(".env"):
        for line in open(".env", encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                if k and k not in os.environ:
                    os.environ[k] = v.strip().strip('"').strip("'")


def catalog_tmdb_ids(s3, bucket: str, prefix: str = "movies") -> list[int]:
    """All tmdb_ids present in the catalog parquet files on S3."""
    ids: set[int] = set()
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{prefix}/"):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".parquet")]
    log.info("found %s catalog files", len(keys))
    for key in keys:
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as fh:
            s3.download_file(bucket, key, fh.name)
            tmp = fh.name
        try:
            table = pq.read_table(tmp, columns=["tmdb_id"])
            ids.update(int(x) for x in table.column("tmdb_id").to_pylist() if x)
        finally:
            os.unlink(tmp)
    return sorted(ids)


def run() -> None:
    _load_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

    tmdb_key = os.environ.get("TMDB_API_KEY", "")
    bucket = os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME", "")
    if not tmdb_key or not bucket:
        log.error("TMDB_API_KEY and S3_BUCKET are required")
        sys.exit(1)

    s3 = make_s3_client(os.environ.get("AWS_REGION", "us-east-1"))
    # Own ledger (separate DB) so we never collide with pi-ingest's pulls table.
    store = Store(os.environ.get("TRAILERS_DB_PATH", "trailers.db"))
    tmdb = TmdbClient(tmdb_key)

    all_ids = catalog_tmdb_ids(s3, bucket, os.environ.get("S3_PREFIX", "movies"))
    limit = int(os.environ.get("TRAILER_LIMIT", "0"))
    if limit:
        all_ids = all_ids[:limit]
    log.info("catalog has %s movies%s", len(all_ids), f" (testing: limit {limit})" if limit else "")

    # Resume: skip ids already recorded in the pulls table. TRAILER_REFRESH=1
    # re-fetches everything (used to fix previously stored bad trailer keys).
    refresh = os.environ.get("TRAILER_REFRESH", "") not in ("", "0", "false")
    done = set() if refresh else store.pulls_exist(all_ids)
    pending = [i for i in all_ids if i not in done]
    log.info("%s already done, %s to fetch%s", len(done), len(pending), " (REFRESH)" if refresh else "")
    if not pending:
        log.info("nothing to do")
        return

    rows: list[dict] = []
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    fetched = found = 0
    BATCH = 1000  # rows per parquet part — keeps parts small + crash-safe

    def fetch_one(tid: int) -> tuple[int, str | None]:
        try:
            key = tmdb.trailer_key(tid)
        except TmdbError as exc:
            log.warning("tmdb unreachable for %s (%s) — leaving pending", tid, exc)
            return tid, "__PENDING__"
        return tid, key

    def flush_batch() -> None:
        """Upload collected rows, then mark them done in the ledger. A crash
        between fetch and flush leaves those movies pending (they were not
        yet marked done), so nothing is silently lost."""
        nonlocal rows
        if not rows:
            return
        table = pa.Table.from_pylist(rows, schema=SCHEMA)
        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as fh:
            pq.write_table(table, fh.name)
            local = fh.name
        key = f"movies/trailers/part-{int(time.time())}-{rows[0]['tmdb_id']}.parquet"
        size = upload_parquet(s3, bucket, key, local)
        os.unlink(local)
        # Only now record these as done (they're safely on S3).
        store.add_pulls([(r["tmdb_id"], "trailers", 1) for r in rows])
        store.add_s3_write(key, len(rows), size)
        log.info("uploaded %s (%s rows)", key, len(rows))
        rows = []

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(fetch_one, tid): tid for tid in pending}
        for fut in as_completed(futures):
            tid, key = fut.result()
            if key == "__PENDING__":
                continue  # not recorded -> retried next run
            fetched += 1
            if key:
                rows.append({"tmdb_id": tid, "trailer_key": key, "source": "tmdb", "fetched_at": now})
                found += 1
            else:
                # Genuinely no trailer on TMDB — record as done immediately
                # (nothing to store; absence in the output = no trailer).
                store.add_pulls([(tid, "trailers", 1)])
            if fetched % 200 == 0:
                log.info("processed %s/%s (found %s trailers)", fetched, len(pending), found)
            if len(rows) >= BATCH:
                flush_batch()

    flush_batch()
    log.info("done: %s processed, %s trailers found", fetched, found)


if __name__ == "__main__":
    run()
