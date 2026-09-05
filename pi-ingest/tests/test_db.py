"""Unit tests for the sqlite store."""

import sqlite3
from pathlib import Path

import pytest

from ingest.db import Store


@pytest.fixture()
def store(tmp_path: Path) -> Store:
    s = Store(str(tmp_path / "test.db"))
    yield s
    s.close()


def test_range_lifecycle(store: Store) -> None:
    assert store.range_status("2020-01-01") is None
    store.range_start("2020-01-01", "2020-12-31")
    assert store.range_status("2020-01-01") == "in_progress"
    store.range_progress("2020-01-01", 3, 40)
    store.range_done("2020-01-01")
    assert store.range_status("2020-01-01") == "done"


def test_pulls_batch_and_exist(store: Store) -> None:
    store.add_pulls([(1, "2020-01-01", 1), (2, "2020-01-01", 2), (3, "2020-01-01", 3)])
    assert store.pulls_exist([1, 5, 9]) == {1}
    # Re-adding is a no-op (idempotent resume).
    store.add_pulls([(1, "2020-01-01", 1), (4, "2020-01-01", 8)])
    assert store.pulls_exist([1, 4]) == {1, 4}


def test_s3_write_record_and_counts(store: Store) -> None:
    store.add_s3_write("movies/year=2020/part-2020-01-01-00000.parquet", 10_000, 1_234_567)
    store.add_s3_write("movies/year=2020/part-2020-01-01-00001.parquet", 5_000, 600_000)
    counts = store.counts()
    assert counts == (0, 0, 2, 15_000)
    # Same key overwrites (idempotent re-runs).
    store.add_s3_write("movies/year=2020/part-2020-01-01-00000.parquet", 10_000, 1_300_000)
    assert store.counts()[2] == 2


def test_persists_across_reopen(tmp_path: Path) -> None:
    path = str(tmp_path / "persist.db")
    s1 = Store(path)
    s1.range_start("2021-01-01", "2021-12-31")
    s1.add_pulls([(7, "2021-01-01", 2)])
    s1.range_done("2021-01-01")
    s1.close()

    s2 = Store(path)
    assert s2.range_status("2021-01-01") == "done"
    assert s2.pulls_exist([7]) == {7}
    s2.close()


def test_wal_enabled(tmp_path: Path) -> None:
    path = str(tmp_path / "wal.db")
    s = Store(path)
    mode = s.conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode == "wal"
    s.close()