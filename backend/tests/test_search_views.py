"""
Integration tests for search API endpoints.
"""

import pytest
from fastapi.testclient import TestClient


class TestSearchStatsEndpoint:
    """Tests for GET /search/stats endpoint."""

    def test_get_stats_success(self, test_client, test_engine, sample_movies):
        """Test successful stats retrieval."""
        response = test_client.get("/search/stats")
        assert response.status_code == 200
        data = response.json()
        assert "min_rating" in data
        assert "max_rating" in data
        assert "min_runtime" in data
        assert "max_runtime" in data
        assert "total_movies" in data
        assert data["total_movies"] == 5

    def test_get_stats_empty_database(self, test_client, test_engine):
        """Test stats with empty database."""
        response = test_client.get("/search/stats")
        assert response.status_code == 200
        data = response.json()
        assert data["total_movies"] == 0


class TestSearchGenresEndpoint:
    """Tests for GET /search/genres endpoint."""

    def test_get_genres_success(self, test_client, test_engine, sample_movies):
        """Test successful genres retrieval."""
        response = test_client.get("/search/genres")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert all("name" in g and "count" in g for g in data)

    def test_get_genres_contains_expected_genres(self, test_client, test_engine, sample_movies):
        """Test genres list contains expected genres."""
        response = test_client.get("/search/genres")
        data = response.json()
        genre_names = [g["name"] for g in data]
        assert "Drama" in genre_names
        assert "Action" in genre_names
        assert "Crime" in genre_names

    def test_get_genres_empty_database(self, test_client, test_engine):
        """Test genres with empty database."""
        response = test_client.get("/search/genres")
        assert response.status_code == 200
        data = response.json()
        assert data == []


class TestStructuralSearchEndpoint:
    """Tests for POST /search/structural endpoint."""

    def test_search_no_filters(self, test_client, test_engine, sample_movies):
        """Test search with no filters returns all movies."""
        response = test_client.post("/search/structural", json={})
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert "total" in data
        assert "skip" in data
        assert "limit" in data
        assert "has_more" in data
        assert data["total"] == 5

    def test_search_with_query(self, test_client, test_engine, sample_movies):
        """Test search with movie name query."""
        response = test_client.post("/search/structural", json={"query": "Dark Knight"})
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["results"][0]["movie_name"] == "The Dark Knight"

    def test_search_with_genre_filter(self, test_client, test_engine, sample_movies):
        """Test search with genre filter."""
        response = test_client.post("/search/structural", json={"genre": "Action"})
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2  # Dark Knight and Inception

    def test_search_with_rating_range(self, test_client, test_engine, sample_movies):
        """Test search with rating range filter."""
        response = test_client.post(
            "/search/structural",
            json={"min_rating": 9.0, "max_rating": 9.5}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3  # Shawshank, Godfather, Dark Knight

    def test_search_with_runtime_range(self, test_client, test_engine, sample_movies):
        """Test search with runtime range filter."""
        response = test_client.post(
            "/search/structural",
            json={"min_runtime": 150, "max_runtime": 160}
        )
        assert response.status_code == 200
        data = response.json()
        # Dark Knight 152, Pulp Fiction 154
        assert data["total"] == 2

    def test_search_with_directors_filter(self, test_client, test_engine, sample_movies):
        """Test search with directors filter."""
        response = test_client.post(
            "/search/structural",
            json={"directors": "Nolan"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2  # Dark Knight and Inception

    def test_search_with_stars_filter(self, test_client, test_engine, sample_movies):
        """Test search with stars filter."""
        response = test_client.post(
            "/search/structural",
            json={"stars": "DiCaprio"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["results"][0]["movie_name"] == "Inception"

    def test_search_combined_filters(self, test_client, test_engine, sample_movies):
        """Test search with multiple filters combined."""
        response = test_client.post(
            "/search/structural",
            json={
                "genre": "Crime",
                "min_rating": 9.0,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2  # Dark Knight and Godfather

    def test_search_sorting_rating_desc(self, test_client, test_engine, sample_movies):
        """Test search with rating descending sort."""
        response = test_client.post(
            "/search/structural",
            json={"sort_by": "rating", "sort_order": "desc"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["rating"] == 9.3  # Shawshank

    def test_search_sorting_rating_asc(self, test_client, test_engine, sample_movies):
        """Test search with rating ascending sort."""
        response = test_client.post(
            "/search/structural",
            json={"sort_by": "rating", "sort_order": "asc"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["rating"] == 8.8  # Inception

    def test_search_sorting_runtime(self, test_client, test_engine, sample_movies):
        """Test search with runtime sort."""
        response = test_client.post(
            "/search/structural",
            json={"sort_by": "runtime", "sort_order": "desc"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["runtime"] == 175  # Godfather

    def test_search_sorting_name(self, test_client, test_engine, sample_movies):
        """Test search with movie name sort."""
        response = test_client.post(
            "/search/structural",
            json={"sort_by": "movie_name", "sort_order": "asc"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["movie_name"] == "Inception"

    def test_search_pagination(self, test_client, test_engine, sample_movies):
        """Test search pagination."""
        response = test_client.post(
            "/search/structural",
            json={"skip": 0, "limit": 2}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 2
        assert data["total"] == 5
        assert data["has_more"] is True

    def test_search_pagination_second_page(self, test_client, test_engine, sample_movies):
        """Test search pagination second page."""
        response = test_client.post(
            "/search/structural",
            json={"skip": 2, "limit": 2}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 2
        assert data["skip"] == 2
        assert data["has_more"] is True

    def test_search_pagination_last_page(self, test_client, test_engine, sample_movies):
        """Test search pagination last page."""
        response = test_client.post(
            "/search/structural",
            json={"skip": 4, "limit": 2}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 1
        assert data["has_more"] is False

    def test_search_no_results(self, test_client, test_engine, sample_movies):
        """Test search with no matching results."""
        response = test_client.post(
            "/search/structural",
            json={"query": "NonExistentMovie123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["results"] == []
        assert data["has_more"] is False

    def test_search_invalid_rating(self, test_client, test_engine):
        """Test search with invalid rating value."""
        response = test_client.post(
            "/search/structural",
            json={"min_rating": 15.0}  # Invalid: > 10
        )
        assert response.status_code == 422  # Validation error

    def test_search_invalid_limit(self, test_client, test_engine):
        """Test search with invalid limit value."""
        response = test_client.post(
            "/search/structural",
            json={"limit": 0}  # Invalid: must be >= 1
        )
        assert response.status_code == 422

    def test_search_invalid_skip(self, test_client, test_engine):
        """Test search with invalid skip value."""
        response = test_client.post(
            "/search/structural",
            json={"skip": -1}  # Invalid: must be >= 0
        )
        assert response.status_code == 422

    def test_search_response_structure(self, test_client, test_engine, sample_movies):
        """Test search response has correct structure."""
        response = test_client.post("/search/structural", json={})
        assert response.status_code == 200
        data = response.json()
        
        # Check top-level structure
        assert set(data.keys()) == {"results", "total", "skip", "limit", "has_more"}
        
        # Check movie result structure
        if data["results"]:
            movie = data["results"][0]
            expected_fields = {
                "id", "movie_name", "rating", "runtime", "genre", 
                "metascore", "plot", "directors", "stars", "votes", 
                "gross", "poster_url"
            }
            assert set(movie.keys()) == expected_fields
