"""Load FlickFindr parquet files from S3 into the backend Postgres `movies`
table (idempotent upsert on tmdb_id), then the backend's `npm run embeddings`
vectorizes the plots.

Usage (run from this dir with a venv that has requirements.txt installed):
    python load.py                       # uses env from ../.env and ../backend/.env
    python load.py --year 2024           # load a single year partition
    python load.py --dry-run             # count/print only, no DB writes

Env read (values never printed):
    ../.env         AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME
    ../backend/.env DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
    or DB_URL=postgresql://user:pass@host:port/db overrides all DB settings
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import boto3
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]


def _load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _cfg() -> tuple[dict[str, str], str, str]:
    root_env = {**os.environ, **_load_env(ROOT / ".env")}
    backend_env = _load_env(ROOT / "backend" / ".env")

    aws = {
        "aws_access_key_id": root_env.get("AWS_ACCESS_KEY_ID", ""),
        "aws_secret_access_key": root_env.get("AWS_SECRET_ACCESS_KEY", ""),
    }
    bucket = root_env.get("AWS_S3_BUCKET_NAME") or root_env.get("S3_BUCKET", "")
    if not all(aws.values()) or not bucket:
        sys.exit("Missing AWS creds / bucket in ../.env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME)")

    db_url = os.environ.get("DB_URL", "") or backend_env.get("DB_URL", "")
    if not db_url:
        host = backend_env.get("DB_HOST", "localhost")
        port = backend_env.get("DB_PORT", "5433")
        name = backend_env.get("DB_NAME", "flickfindr")
        user = backend_env.get("DB_USER", "flickfindr")
        pw = backend_env.get("DB_PASSWORD", "flickfindr")
        db_url = f"postgresql://{user}:{pw}@{host}:{port}/{name}"
    return aws, bucket, db_url


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Load S3 parquet movies into backend Postgres")
    p.add_argument("--prefix", default="movies", help="S3 prefix (default: movies)")
    p.add_argument("--year", help="only load this year partition (e.g. 2024)")
    p.add_argument("--dry-run", action="store_true", help="count only, no DB writes")
    return p.parse_args()


def _list_keys(s3, bucket: str, prefix: str, year: str | None) -> list[str]:
    prefix_path = f"{prefix}/year={year}/" if year else f"{prefix}/"
    keys: list[str] = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix_path):
        keys += [o["Key"] for o in page.get("Contents", [])]
    return sorted(keys)


def _rows_from_s3(s3, bucket: str, key: str):
    """Stream a parquet file from S3 via the local disk (bounded memory)."""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as fh:
        s3.download_file(bucket, key, fh.name)
        tmp = fh.name
    try:
        table = pq.read_table(tmp)
        yield from table.to_pylist()
    finally:
        os.unlink(tmp)


UPSERT = """
INSERT INTO movies (tmdb_id, movie_name, rating, runtime, genre, metascore, plot,
                    directors, stars, votes, gross, poster_url)
VALUES (%(tmdb_id)s, %(movie_name)s, %(rating)s, %(runtime)s, %(genre)s, NULL,
        %(plot)s, %(directors)s, %(stars)s, %(votes)s, %(gross)s, %(poster_url)s)
ON CONFLICT (tmdb_id) DO UPDATE SET
  movie_name = EXCLUDED.movie_name, rating = EXCLUDED.rating,
  runtime = EXCLUDED.runtime, genre = EXCLUDED.genre, plot = EXCLUDED.plot,
  directors = EXCLUDED.directors, stars = EXCLUDED.stars, votes = EXCLUDED.votes,
  gross = EXCLUDED.gross, poster_url = EXCLUDED.poster_url
"""


def main() -> None:
    args = _parse_args()
    aws, bucket, db_url = _cfg()
    s3 = boto3.client("s3", region_name="us-east-1", **aws)
    keys = _list_keys(s3, bucket, args.prefix, args.year)
    if not keys:
        sys.exit(f"No parquet files found under s3://{bucket}/{args.prefix}/…")

    import psycopg

    total = 0
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            for key in keys:
                count = 0
                for row in _rows_from_s3(s3, bucket, key):
                    if not (row.get("plot") or "").strip():
                        continue  # never load rows without a plot
                    total += 1
                    count += 1
                    if args.dry_run:
                        continue
                    cur.execute(UPSERT, {
                        "tmdb_id": row["tmdb_id"],
                        "movie_name": (row.get("movie_name") or "")[:255] or f"Movie {row['tmdb_id']}",
                        "rating": row.get("rating"),
                        "runtime": row.get("runtime"),
                        "genre": row.get("genre"),
                        "plot": row.get("plot"),
                        "directors": row.get("directors"),
                        "stars": row.get("stars"),
                        "votes": row.get("votes"),
                        "gross": row.get("gross"),
                        "poster_url": row.get("poster_url"),
                    })
                if not args.dry_run and count:
                    conn.commit()
                print(f"{key}: {count} rows{' (dry-run)' if args.dry_run else ' upserted'}", flush=True)
    if args.dry_run:
        print(f"dry-run total rows that would load: {total}")
    else:
        print(f"Loaded {total} rows into movies (tmdb_id upsert). Next: cd backend && npm run embeddings")


if __name__ == "__main__":
    main()