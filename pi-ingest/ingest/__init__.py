"""FlickFindr Pi ingestion package (TMDB → parquet → S3)."""

from .pipeline import main

__all__ = ["main"]