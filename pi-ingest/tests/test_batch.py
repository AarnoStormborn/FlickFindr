"""Unit tests for the memory-bounded parquet batcher."""

from pathlib import Path

import pyarrow.parquet as pq

from ingest.parquet_batch import SCHEMA, BatchWriter


def _row(tmdb_id: int, year: int = 2000) -> dict:
    return {
        "tmdb_id": tmdb_id,
        "movie_name": f"Movie {tmdb_id}",
        "release_year": year,
        "rating": 7.5,
        "runtime": 120,
        "genre": "Drama",
        "plot": f"Plot number {tmdb_id} about something meaningful.",
        "directors": "Someone",
        "stars": "Actor One, Actor Two",
        "votes": 1234,
        "gross": 1_000_000,
        "poster_url": None,
        "fetched_at": None,
    }


def test_flush_writes_parquet_with_schema(tmp_path: Path) -> None:
    writer = BatchWriter(str(tmp_path), rows_per_file=100)
    for i in range(5):
        writer.add(_row(i, year=2024))
    path, count = writer.flush()
    assert path is not None
    assert count == 5

    table = pq.read_table(path)
    assert table.schema.equals(SCHEMA)
    assert table.num_rows == 5
    assert table.column("movie_name").to_pylist() == [f"Movie {i}" for i in range(5)]


def test_empty_flush_is_noop(tmp_path: Path) -> None:
    writer = BatchWriter(str(tmp_path), rows_per_file=100)
    path, count = writer.flush()
    assert path is None
    assert count == 0


def test_multi_file_batching(tmp_path: Path) -> None:
    writer = BatchWriter(str(tmp_path), rows_per_file=2)
    results = []
    # Caller-driven flush contract (pipeline calls flush when pending >= batch).
    for i in range(2):
        writer.add(_row(i))
    results.append(writer.flush()[1])
    for i in range(2, 5):
        writer.add(_row(i))
    results.append(writer.flush()[1])
    for i in range(5, 8):
        writer.add(_row(i))
    results.append(writer.flush()[1])
    assert results == [2, 3, 3]
    assert writer.flush()[0] is None


def test_null_fields_allowed(tmp_path: Path) -> None:
    writer = BatchWriter(str(tmp_path), rows_per_file=10)
    row = _row(99)
    row["rating"] = None
    row["votes"] = None
    row["gross"] = None
    row["directors"] = None
    row["poster_url"] = None
    writer.add(row)
    path, count = writer.flush()
    assert count == 1
    table = pq.read_table(path)
    assert table.column("rating").to_pylist() == [None]
    assert table.column("gross").to_pylist() == [None]