"""FlickFindr Pi ingestion — TMDB → parquet → S3, memory-efficient.

Runs as:  python -m ingest [options]
Designed for low-RAM hosts (Raspberry Pi ~800MB shared with other jobs).
Everything is resumable: sqlite tracks ranges, per-movie pulls, and S3 writes.
"""

from .pipeline import main

if __name__ == "__main__":
    main()