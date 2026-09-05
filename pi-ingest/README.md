# FlickFindr Pi Ingest

Memory-efficient ingestion job for low-RAM hosts (Raspberry Pi / DietPi,
~800MB shared with other jobs): **TMDB → parquet → S3**, with every pull and
S3 write recorded in a local **SQLite** ledger.

## How it works

```
TMDB /discover/movie (1980..current, vote_count>=50, year-by-year)
        │  + /movie/{id}/credits (directors + top-10 cast, bounded pool)
        ▼
rows accumulate in memory → every BATCH_ROWS (default 10k) → one parquet file
        │  (~few MB in RAM; buffers freed after each flush)
        ▼
file streamed to S3 (single-threaded multipart parts) → recorded in sqlite
```

### Memory profile
- **pyarrow** streams each batch to disk (never the whole dataset in RAM)
- **boto3** uploads fileobj with `max_concurrency=1` (`use_threads=False`),
  8MB parts — the only in-flight S3 buffer is one part
- **sqlite** is stdlib; WAL mode; writes are batched and synchronous
- Peak RSS ≈ runtime (~30MB) + pyarrow import spike (~90MB) + one batch
  (~15MB) + one upload part — **well under 250MB** at defaults. Tune lower
  with `BATCH_ROWS=5000 CONCURRENCY=4` if needed.

### Resume, not re-pull
Three SQLite tables make the run **idempotent and resumable** (crash-safe,
Ctrl+C-safe):

| Table | Purpose |
|-------|---------|
| `ranges` | one row per release-date range: `in_progress` / `done`, page + pulled counters |
| `pulls` | one row per fetched movie (`tmdb_id` unique) — re-runs skip already-pulled ids |
| `s3_writes` | one row per uploaded parquet file: key, rows, bytes, status, timestamps |

Done ranges are never re-fetched. Interrupted runs restart from the last page.

### Output layout (S3)
```
s3://<bucket>/movies/year=1980/part-1980-01-01-00000.parquet
s3://<bucket>/movies/year=2001/part-2001-01-01-00000.parquet
...
```
Hive-style `year=` partitions — ready for Athena/DuckDB/Spark. Parquet schema:
`tmdb_id, movie_name, release_year, rating, runtime, genre, plot, directors,
stars, votes, gross, poster_url, fetched_at`.

Files that would exceed TMDB's 500-page/10k-result cap per query are
**split in half** and re-paged — nothing is silently truncated.

## Setup on the Pi (DietPi)

```bash
sudo apt update && sudo apt install -y python3 python3-venv git
git clone <repo> && cd pi-ingest
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt      # dev: also requirements-dev.txt
cp .env.example .env && nano .env              # TMDB_API_KEY, S3_BUCKET, AWS creds
```

## Run

```bash
# Smoke test — no S3 writes, 5 movies:
.venv/bin/python -m ingest --dry-run --limit 5 --start-year 2024 --end-year 2024

# Real run:
.venv/bin/python -m ingest

# Chunked / tuned:
.venv/bin/python -m ingest --start-year 2010 --end-year 2019 \
    --batch-rows 5000 --concurrency 4
```

All options also have env equivalents (`LIMIT`, `PAGE_CAP`, `BATCH_ROWS`,
`CONCURRENCY`, `START_YEAR`, `END_YEAR`, `MIN_VOTE_COUNT`, `DB_PATH`,
`TMP_DIR`, `S3_PREFIX`) — CLI wins.

### systemd unit (recommended)

```ini
[Unit]
Description=FlickFindr TMDB->S3 ingestion
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/dietpi/flickfindr/pi-ingest
ExecStart=/home/dietpi/flickfindr/pi-ingest/.venv/bin/python -m ingest
Restart=on-failure
RestartSec=30
Nice=10
MemoryMax=384M
StandardOutput=journal

[Install]
WantedBy=multi-user.target
```

`MemoryMax` is optional; the job tolerates being starved. Since done ranges
are never re-pulled, run it periodically (e.g. `systemd.timer` monthly) to
pick up new releases without redoing history.

## Local dev / tests

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/pytest tests/
```