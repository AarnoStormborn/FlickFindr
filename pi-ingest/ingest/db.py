"""SQLite store: range checkpoints, per-movie pull ledger, S3 write ledger.

WAL mode + batched writes keep latency and memory tiny. Single-writer locked
connection (the pipeline is single-process anyway)."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from typing import Iterable


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: str) -> None:
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ranges (
                gte TEXT PRIMARY KEY,
                lte TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                page INTEGER NOT NULL DEFAULT 0,
                pulled INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                finished_at TEXT
            );
            CREATE TABLE IF NOT EXISTS pulls (
                tmdb_id INTEGER PRIMARY KEY,
                range_gte TEXT NOT NULL,
                page INTEGER NOT NULL,
                fetched_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS s3_writes (
                s3_key TEXT PRIMARY KEY,
                row_count INTEGER NOT NULL,
                bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_pulls_range ON pulls (range_gte);
            """
        )
        self.conn.commit()

    # ---- ranges -----------------------------------------------------------
    def range_status(self, gte: str) -> str | None:
        with self._lock:
            row = self.conn.execute(
                "SELECT status FROM ranges WHERE gte = ?", (gte,)
            ).fetchone()
        return row[0] if row else None

    def range_start(self, gte: str, lte: str) -> None:
        with self._lock:
            self.conn.execute(
                """INSERT INTO ranges (gte, lte, status, started_at)
                   VALUES (?, ?, 'in_progress', ?)
                   ON CONFLICT (gte) DO UPDATE SET started_at = COALESCE(ranges.started_at, excluded.started_at)""",
                (gte, lte, _now()),
            )
            self.conn.commit()

    def range_progress(self, gte: str, page: int, pulled: int) -> None:
        with self._lock:
            self.conn.execute(
                "UPDATE ranges SET page = ?, pulled = pulled + ? WHERE gte = ?",
                (page, pulled, gte),
            )
            self.conn.commit()

    def range_done(self, gte: str) -> None:
        with self._lock:
            self.conn.execute(
                "UPDATE ranges SET status = 'done', finished_at = ? WHERE gte = ?",
                (_now(), gte),
            )
            self.conn.commit()

    # ---- pulls ------------------------------------------------------------
    def pulls_exist(self, tmdb_ids: Iterable[int]) -> set[int]:
        ids = list(tmdb_ids)
        if not ids:
            return set()
        with self._lock:
            placeholders = ",".join("?" * len(ids))
            rows = self.conn.execute(
                f"SELECT tmdb_id FROM pulls WHERE tmdb_id IN ({placeholders})", ids
            ).fetchall()
        return {r[0] for r in rows}

    def add_pulls(self, rows: list[tuple[int, str, int]]) -> None:
        """rows: (tmdb_id, range_gte, page). Batched insert in one transaction."""
        if not rows:
            return
        fetched_at = _now()
        with self._lock:
            self.conn.executemany(
                "INSERT OR IGNORE INTO pulls (tmdb_id, range_gte, page, fetched_at) VALUES (?, ?, ?, ?)",
                [(t, g, p, fetched_at) for t, g, p in rows],
            )
            self.conn.commit()

    # ---- s3 writes --------------------------------------------------------
    def add_s3_write(self, s3_key: str, row_count: int, size_bytes: int) -> None:
        with self._lock:
            self.conn.execute(
                """INSERT INTO s3_writes (s3_key, row_count, bytes, status, started_at, finished_at)
                   VALUES (?, ?, ?, 'uploaded', ?, ?)
                   ON CONFLICT (s3_key) DO UPDATE SET status = 'uploaded', finished_at = excluded.finished_at""",
                (s3_key, row_count, size_bytes, _now(), _now()),
            )
            self.conn.commit()

    # ---- accounting -------------------------------------------------------
    def counts(self) -> tuple[int, int, int, int]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT (SELECT count(*) FROM ranges), (SELECT count(*) FROM pulls), "
                "(SELECT count(*) FROM s3_writes), "
                "(SELECT COALESCE(sum(row_count),0) FROM s3_writes)"
            ).fetchone()
        return tuple(int(x or 0) for x in rows)  # type: ignore[return-value]

    def close(self) -> None:
        with self._lock:
            self.conn.commit()
            self.conn.close()