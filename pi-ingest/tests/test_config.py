"""Config loading: env precedence and CLI overrides."""

from ingest.config import load_config


def test_env_then_cli(monkeypatch) -> None:
    monkeypatch.setenv("TMDB_API_KEY", "env-key")
    monkeypatch.setenv("LIMIT", "100")
    cfg = load_config(["--start-year", "1990", "--dry-run"])
    assert cfg.tmdb_api_key == "env-key"
    assert cfg.start_year == 1990      # CLI wins over env default
    assert cfg.limit == 100            # env wins over default
    assert cfg.dry_run is True
    assert cfg.end_year >= 2020


def test_missing_aws_removed_require(monkeypatch) -> None:
    monkeypatch.setenv("TMDB_API_KEY", "k")
    cfg = load_config(["--dry-run"])
    cfg.require("tmdb_api_key")
    # No S3 bucket required in dry-run; real runs will call require("s3_bucket").