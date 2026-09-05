"""Configuration: env + .env file + CLI overrides (CLI wins)."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass, field
from datetime import date


def _load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader (no extra dependency). Never overrides real env."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    tmdb_api_key: str = ""
    s3_bucket: str = ""
    aws_region: str = ""

    start_year: int = 1980
    end_year: int = field(default_factory=lambda: date.today().year)
    min_vote_count: int = 50

    # Memory knobs: batch_rows bounds peak RAM (a batch of ~10k rows is a
    # handful of MB in arrow + a few MB of parquet in transit).
    batch_rows: int = 10_000
    concurrency: int = 6

    db_path: str = "ingest.db"
    tmp_dir: str = ".tmp"
    s3_prefix: str = "movies"

    # Smoke-test knobs.
    limit: int = 0        # stop after N movies globally (0 = unlimited)
    page_cap: int = 0     # max discovery pages per range (0 = unlimited)

    dry_run: bool = False

    api_base: str = "https://api.themoviedb.org/3"
    max_pages: int = 500  # TMDB hard cap per query (10k results)

    def require(self, *keys: str) -> None:
        missing = [k for k in keys if not getattr(self, k)]
        if missing:
            raise SystemExit(
                f"Missing required setting(s): {', '.join(missing)}. "
                "Set them in .env or pass CLI flags (see README)."
            )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="ingest", description="TMDB → parquet → S3 ingestion")
    p.add_argument("--start-year", type=int)
    p.add_argument("--end-year", type=int)
    p.add_argument("--min-vote-count", type=int)
    p.add_argument("--batch-rows", type=int)
    p.add_argument("--concurrency", type=int)
    p.add_argument("--bucket", dest="s3_bucket")
    p.add_argument("--region", dest="aws_region")
    p.add_argument("--prefix", dest="s3_prefix")
    p.add_argument("--db", dest="db_path")
    p.add_argument("--tmdb-key", dest="tmdb_api_key")
    p.add_argument("--limit", type=int)
    p.add_argument("--page-cap", type=int)
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args(argv)


def load_config(argv: list[str] | None = None) -> Config:
    _load_dotenv()
    cfg = Config(
        tmdb_api_key=os.environ.get("TMDB_API_KEY", ""),
        s3_bucket=os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME", ""),
        aws_region=os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "")),
        start_year=_env_int("START_YEAR", 1980),
        end_year=_env_int("END_YEAR", date.today().year),
        min_vote_count=_env_int("MIN_VOTE_COUNT", 50),
        batch_rows=_env_int("BATCH_ROWS", 10_000),
        concurrency=_env_int("CONCURRENCY", 6),
        db_path=os.environ.get("DB_PATH", "ingest.db"),
        tmp_dir=os.environ.get("TMP_DIR", ".tmp"),
        s3_prefix=os.environ.get("S3_PREFIX", "movies"),
        limit=_env_int("LIMIT", 0),
        page_cap=_env_int("PAGE_CAP", 0),
    )
    args = parse_args(argv)
    for key in ("start_year", "end_year", "min_vote_count", "batch_rows", "concurrency",
                "s3_bucket", "aws_region", "s3_prefix", "db_path", "tmdb_api_key",
                "limit", "page_cap"):
        value = getattr(args, key)
        if value is not None:
            setattr(cfg, key, value)
    if args.dry_run:
        cfg.dry_run = True
    return cfg