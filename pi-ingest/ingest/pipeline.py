"""Pipeline orchestrator: TMDB → parquet files → S3, all recorded in sqlite.

Flow per release-year range (1980..current by default):
  1. Skip ranges already marked `done` in sqlite (no re-pull).
  2. Page through /discover/movie; skip movies already recorded in `pulls`.
  3. Enrich with credits (bounded thread pool), accumulate rows.
  4. Every `batch_rows` rows: write one parquet file → stream to S3 →
     record it in `s3_writes`. Buffers are released after each flush.
  5. Mark the range `done`. Fully resumable across crashes / Ctrl+C.

Ranges that hit TMDB's 500-page cap are split in half recursively.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date as dt_date, timedelta
from typing import Any

from .config import Config, load_config
from .db import Store
from .parquet_batch import BatchWriter
from .s3upload import make_s3_client, upload_parquet
from .tmdb import TmdbClient

log = logging.getLogger("ingest")


class _Ctx:
    def __init__(self, cfg: Config, store: Store, tmdb: TmdbClient, s3: Any) -> None:
        self.cfg = cfg
        self.store = store
        self.tmdb = tmdb
        self.s3 = s3
        self.processed = 0
        self.flushed = 0
        self.stopped = False  # set when --limit is reached


def _midpoint_split(gte: str, lte: str) -> tuple[str, str] | None:
    d1 = dt_date.fromisoformat(gte)
    d2 = dt_date.fromisoformat(lte)
    mid = d1 + (d2 - d1) // 2
    if mid <= d1 or mid >= d2:
        return None  # stuck: range too small to split
    return mid.isoformat(), (mid + timedelta(days=1)).isoformat()


def _build_row(
    ctx: _Ctx,
    movie: dict[str, Any],
    page: int,
    enrichment: tuple[str | None, str | None, int | None, int | None],
    range_year: int,
) -> dict[str, Any] | None:
    overview = (movie.get("overview") or "").strip()
    if not overview:
        return None  # no plot → no value; not recorded as pulled either
    release = (movie.get("release_date") or "")[:4]
    try:
        release_year = int(release)
    except ValueError:
        release_year = range_year
    votes = movie.get("vote_count")
    directors, stars, runtime, revenue = enrichment
    return {
        "tmdb_id": movie["id"],
        "movie_name": (movie.get("title") or f"Movie {movie['id']}")[:255],
        "release_year": release_year,
        "rating": movie.get("vote_average"),
        "runtime": runtime,
        "genre": _genres_str(ctx, movie.get("genre_ids") or []),
        "plot": overview,
        "directors": directors,
        "stars": stars,
        "votes": votes if isinstance(votes, int) else (int(votes) if votes else None),
        "gross": revenue,
        "poster_url": f"https://image.tmdb.org/t/p/w500{movie['poster_path']}" if movie.get("poster_path") else None,
    }


def _genres_str(ctx: _Ctx, genre_ids: list[int]) -> str | None:
    names = [ctx.tmdb.genres().get(gid) for gid in genre_ids]
    names = [n for n in names if n]
    return ", ".join(names) or None


def _flush_and_upload(ctx: _Ctx, writer: BatchWriter, gte: str, seq: int) -> int:
    """Flush current batch → S3 (or discard in dry-run) → ledger. Returns next seq."""
    path, row_count = writer.flush()
    if path is None:
        return seq
    if ctx.cfg.dry_run:
        os.remove(path)
        log.info("dry-run: would write %s rows to parquet (S3 skipped)", row_count)
        return seq + 1
    key = f"{ctx.cfg.s3_prefix}/year={gte[:4]}/part-{gte}-{seq:05d}.parquet"
    size = upload_parquet(ctx.s3, ctx.cfg.s3_bucket, key, path)
    os.remove(path)
    ctx.store.add_s3_write(key, row_count, size)
    ctx.flushed += 1
    log.info("uploaded %s (%s rows, %.1f MB)", key, row_count, size / 1e6)
    return seq + 1


def _fetch_range(ctx: _Ctx, gte: str, lte: str) -> None:
    cfg = ctx.cfg
    status = ctx.store.range_status(gte)
    if status == "done":
        log.info("range %s..%s already done — skipping", gte, lte)
        return
    ctx.store.range_start(gte, lte)

    first = ctx.tmdb.discover(gte, lte, 1, cfg.min_vote_count)
    total_pages = int(first.get("total_pages", 0))
    if total_pages >= cfg.max_pages and cfg.page_cap == 0:
        split = _midpoint_split(gte, lte)
        if split:
            log.warning("range %s..%s hits %s pages — splitting", gte, lte, total_pages)
            _fetch_range(ctx, gte, split[0])
            _fetch_range(ctx, split[1], lte)
            ctx.store.range_done(gte)
            return
        raise RuntimeError(f"range {gte}..{lte} too large to split further")

    pages = min(total_pages, cfg.page_cap if cfg.page_cap > 0 else total_pages)
    if pages == 0:
        ctx.store.range_done(gte)
        return
    log.info("range %s..%s: %s pages", gte, lte, pages)

    writer = BatchWriter(cfg.tmp_dir, cfg.batch_rows)
    seq = 0
    try:
        with ThreadPoolExecutor(max_workers=cfg.concurrency) as pool:
            for page in range(1, pages + 1):
                data = first if page == 1 else ctx.tmdb.discover(gte, lte, page, cfg.min_vote_count)
                if ctx.cfg.limit > 0:
                    remaining = ctx.cfg.limit - ctx.processed
                    if remaining <= 0:
                        ctx.stopped = True
                        break
                    data["results"] = data["results"][:remaining]

                movies = [m for m in data.get("results", []) if (m.get("overview") or "").strip()]
                if not movies:
                    continue
                already = ctx.store.pulls_exist(m["id"] for m in movies)
                todo = [m for m in movies if m["id"] not in already]
                if not todo:
                    continue

                # Enrichment (detail + credits in one call), bounded concurrency,
                # consumed in main thread.
                futures = {pool.submit(ctx.tmdb.credits_and_detail, m["id"]): m for m in todo}
                for future in as_completed(futures):
                    movie = futures[future]
                    _consume(ctx, writer, gte, page, movie, future.result())

                ctx.store.range_progress(gte, page, len(todo))
                if writer.pending() >= cfg.batch_rows:
                    seq = _flush_and_upload(ctx, writer, gte, seq)
                if ctx.stopped:
                    break
    finally:
        seq = _flush_and_upload(ctx, writer, gte, seq)
    if not ctx.stopped:
        ctx.store.range_done(gte)
    else:
        log.warning("range %s..%s left in_progress (limit reached) — will resume later", gte, lte)


def _consume(ctx: _Ctx, writer: BatchWriter, gte: str, page: int, movie: dict[str, Any], enrichment: tuple[str | None, str | None, int | None, int | None]) -> None:
    row = _build_row(ctx, movie, page, enrichment, int(gte[:4]))
    if row is None:
        return
    writer.add(row)
    ctx.store.add_pulls([(row["tmdb_id"], gte, page)])
    ctx.processed += 1


def main(argv: list[str] | None = None) -> int:
    cfg = load_config(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        stream=sys.stdout,
    )
    cfg.require("tmdb_api_key")
    if not cfg.dry_run:
        cfg.require("s3_bucket")

    store = Store(cfg.db_path)
    tmdb = TmdbClient(cfg.tmdb_api_key, cfg.api_base)
    s3 = make_s3_client(cfg.aws_region) if not cfg.dry_run else None
    ctx = _Ctx(cfg, store, tmdb, s3)
    log.info(
        "ingest start: years %s..%s, vote_count>=%s, batch=%s, concurrency=%s, dry_run=%s",
        cfg.start_year, cfg.end_year, cfg.min_vote_count, cfg.batch_rows, cfg.concurrency, cfg.dry_run,
    )

    def _handle_sigint(_signum: int, _frame: Any) -> None:
        log.warning("interrupt received — finishing current batch, resumable")
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, _handle_sigint)

    try:
        for year in range(cfg.start_year, cfg.end_year + 1):
            if ctx.stopped:
                break
            _fetch_range(ctx, f"{year}-01-01", f"{year}-12-31")
            if ctx.stopped:
                break
    except KeyboardInterrupt:
        log.warning("interrupted; sqlite checkpoints + partial parquet files preserved")
    finally:
        ranges, pulls, writes, rows = store.counts()
        log.info(
            "ingest done: ranges=%s pulls=%s s3_files=%s s3_rows=%s processed_this_run=%s",
            ranges, pulls, writes, rows, ctx.processed,
        )
        store.close()
    return 0 if not ctx.stopped else 0