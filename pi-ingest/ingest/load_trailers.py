"""Load trailer parquet from S3 into the app database (by tmdb_id).

Runs on the Pi as part of the monthly trailer job, after `ingest.trailers`
has written new `movies/trailers/*.parquet` parts.

Incremental: a small JSON state file records which S3 keys have already been
applied, so repeat runs only push newly-written parts (and a failed run
resumes where it stopped).

Usage (from pi-ingest/):
    DATABASE_URL=postgres://... S3_BUCKET=... python -m ingest.load_trailers
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile

import boto3
import psycopg
import pyarrow.parquet as pq

log = logging.getLogger("ingest.load_trailers")

STATE_PATH_DEFAULT = ".trailers-loaded.json"


def _load_env() -> None:
    if os.path.exists(".env"):
        for line in open(".env", encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                if k and k not in os.environ:
                    os.environ[k] = v.strip().strip('"').strip("'")


def _read_state(path: str) -> set[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return set(data.get("loaded", []))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()


def _write_state(path: str, loaded: set[str]) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"loaded": sorted(loaded)}, fh)
    os.replace(tmp, path)


def _list_trailer_keys(s3, bucket: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="movies/trailers/"):
        keys += [o["Key"] for o in page.get("Contents", []) if o["Key"].endswith(".parquet")]
    return sorted(keys)


def _rows(s3, bucket: str, key: str):
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as fh:
        s3.download_file(bucket, key, fh.name)
        tmp = fh.name
    try:
        yield from pq.read_table(tmp).to_pylist()
    finally:
        os.unlink(tmp)


def main() -> None:
    _load_env()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )

    bucket = os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME", "")
    db_url = os.environ.get("DATABASE_URL", "")
    if not bucket or not db_url:
        log.error("S3_BUCKET and DATABASE_URL are required")
        sys.exit(1)

    state_path = os.environ.get("TRAILERS_LOAD_STATE", STATE_PATH_DEFAULT)

    s3 = boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    keys = _list_trailer_keys(s3, bucket)
    loaded = _read_state(state_path)
    todo = [k for k in keys if k not in loaded]
    log.info("%s trailer parts, %s already loaded, %s to load", len(keys), len(loaded), len(todo))
    if not todo:
        log.info("nothing to load")
        return

    total = 0
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            for key in todo:
                count = 0
                for row in _rows(s3, bucket, key):
                    tkey = row.get("trailer_key")
                    tid = row.get("tmdb_id")
                    if not tkey or tid is None:
                        continue
                    cur.execute(
                        "UPDATE movies SET trailer_key = %s, trailer_source = %s, trailer_checked = true"
                        " WHERE tmdb_id = %s",
                        (tkey, row.get("source") or "tmdb", int(tid)),
                    )
                    count += cur.rowcount
                conn.commit()
                loaded.add(key)
                _write_state(state_path, loaded)
                total += count
                log.info("%s: %s movies updated", key, count)

    log.info("done: %s movies updated across %s parts", total, len(todo))


if __name__ == "__main__":
    main()
