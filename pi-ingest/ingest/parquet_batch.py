"""Memory-bounded parquet writer: rows accumulate up to `rows_per_file`,
then one pyarrow batch is streamed to disk and the buffers are released.

Peak extra memory ≈ one batch in memory (a few MB) + one file being written.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema(
    [
        ("tmdb_id", pa.int64()),
        ("movie_name", pa.string()),
        ("release_year", pa.int32()),
        ("rating", pa.float32()),
        ("runtime", pa.int32()),
        ("genre", pa.string()),
        ("plot", pa.string()),
        ("directors", pa.string()),
        ("stars", pa.string()),
        ("votes", pa.int64()),
        ("gross", pa.int64()),
        ("poster_url", pa.string()),
        ("fetched_at", pa.timestamp("ms", tz="UTC")),
    ]
)


def _cast(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()[:500] or None
    return value


class BatchWriter:
    def __init__(self, tmp_dir: str, rows_per_file: int) -> None:
        self.tmp_dir = tmp_dir
        self.rows_per_file = max(200, rows_per_file)
        self._rows: dict[str, list[Any]] = {f.name: [] for f in SCHEMA}
        self._files_written = 0

    def add(self, row: dict[str, Any]) -> None:
        for field in SCHEMA:
            self._rows[field.name].append(_cast(row.get(field.name)))

    def pending(self) -> int:
        return len(self._rows["tmdb_id"])

    def flush(self) -> tuple[str | None, int]:
        """Write the current buffer to a parquet file.
        Returns (temp path, row count), or (None, 0) when empty."""
        if not self._rows["tmdb_id"]:
            return None, 0
        count = self.pending()
        arrays = [pa.array(self._rows[f.name], type=f.type) for f in SCHEMA]
        table = pa.Table.from_arrays(arrays, schema=SCHEMA)
        # Release the row buffers immediately after the arrays are built.
        self._rows = {f.name: [] for f in SCHEMA}
        os.makedirs(self.tmp_dir, exist_ok=True)
        now = datetime.now(timezone.utc)
        path = os.path.join(self.tmp_dir, f"batch-{now.strftime('%Y%m%d-%H%M%S')}-{self._files_written:05d}.parquet")
        pq.write_table(table, path, compression="zstd", data_page_size=262_144)
        self._files_written += 1
        return path, count