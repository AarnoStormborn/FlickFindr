"""TMDB API client: bounded retries, backoff, year-range discovery with
TMDB's 500-page cap handled by range splitting, and credits enrichment."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

log = logging.getLogger("ingest.tmdb")

BACKOFF_BASE_MS = 1_000
MAX_ATTEMPTS = 8


class TmdbError(RuntimeError):
    pass


class TmdbClient:
    def __init__(self, api_key: str, api_base: str = "https://api.themoviedb.org/3") -> None:
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self._session = requests.Session()  # connection reuse (keeps memory low)
        self._genres: dict[int, str] | None = None

    def _get_json(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.api_base}{path}"
        full = {**params, "api_key": self.api_key, "language": "en-US"}
        attempt = 0
        while True:
            try:
                resp = self._session.get(url, params=full, timeout=(5, 30))
            except requests.RequestException as exc:
                attempt += 1
                if attempt > MAX_ATTEMPTS:
                    raise TmdbError(f"network failure for {path}: {exc}") from exc
                delay = min(BACKOFF_BASE_MS * (2**attempt), 30_000) / 1000
                log.warning("tmdb network error (%s), retrying in %.1fs", exc, delay)
                time.sleep(delay)
                continue
            if resp.ok:
                return resp.json()
            if resp.status_code in (429, 500, 502, 503, 504):
                attempt += 1
                if attempt > MAX_ATTEMPTS:
                    raise TmdbError(f"tmdb failed after retries: HTTP {resp.status_code}")
                delay = min(BACKOFF_BASE_MS * (2**attempt), 30_000) / 1000
                log.warning("tmdb HTTP %s, retrying in %.1fs", resp.status_code, delay)
                time.sleep(delay)
                continue
            raise TmdbError(f"tmdb request failed: HTTP {resp.status_code} ({path})")

    def genres(self) -> dict[int, str]:
        if self._genres is None:
            data = self._get_json("/genre/movie/list", {})
            self._genres = {g["id"]: g["name"] for g in data.get("genres", [])}
        return self._genres

    def discover(self, gte: str, lte: str, page: int, min_vote_count: int) -> dict[str, Any]:
        """One page of /discover/movie for a release-date range."""
        return self._get_json("/discover/movie", {
            "primary_release_date.gte": gte,
            "primary_release_date.lte": lte,
            "vote_count.gte": min_vote_count,
            "sort_by": "primary_release_date.asc",
            "include_adult": "false",
            "page": page,
        })

    def credits(self, movie_id: int) -> tuple[str | None, str | None]:
        """(directors, stars) for a movie. Errors degrade to None so one bad
        movie never kills the run; callers may retry later runs."""
        try:
            data = self._get_json(f"/movie/{movie_id}/credits", {})
        except TmdbError as exc:
            log.warning("credits failed for %s: %s", movie_id, exc)
            return None, None
        crew = data.get("crew", [])
        directors = ", ".join(
            c.get("name", "").strip()
            for c in crew
            if c.get("job") == "Director" and c.get("name")
        )[:300] or None
        cast = sorted(
            (c for c in data.get("cast", []) if c.get("name")),
            key=lambda c: c.get("order", 10**9),
        )
        stars = ", ".join(c.get("name", "").strip() for c in cast[:10])[:500] or None
        return directors, stars

    def detail(self, movie_id: int) -> dict:
        """Full /movie/{id} detail (runtime, revenue). Returns {} on failure so
        rows still land with null runtime rather than being dropped."""
        try:
            data = self._get_json(f"/movie/{movie_id}", {})
        except TmdbError as exc:
            log.warning("detail failed for %s: %s", movie_id, exc)
            return {}
        return data

    def credits_and_detail(self, movie_id: int) -> tuple[str | None, str | None, int | None, int | None]:
        """(directors, stars, runtime_minutes, revenue) — one round trip per
        movie keeps the enrichment calls batched and bounded."""
        try:
            data = self._get_json(f"/movie/{movie_id}", {"append_to_response": "credits"})
        except TmdbError as exc:
            log.warning("enrich failed for %s: %s", movie_id, exc)
            return None, None, None, None
        crew = data.get("credits", {}).get("crew", [])
        directors = ", ".join(
            c.get("name", "").strip()
            for c in crew
            if c.get("job") == "Director" and c.get("name")
        )[:300] or None
        cast = sorted(
            (c for c in data.get("credits", {}).get("cast", []) if c.get("name")),
            key=lambda c: c.get("order", 10**9),
        )
        stars = ", ".join(c.get("name", "").strip() for c in cast[:10])[:500] or None
        runtime = data.get("runtime")
        revenue = data.get("revenue")
        return (
            directors,
            stars,
            int(runtime) if isinstance(runtime, int) and runtime > 0 else None,
            int(revenue) if isinstance(revenue, int) and revenue > 0 else None,
        )