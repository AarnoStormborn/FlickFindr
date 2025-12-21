"""
Integration tests for semantic search API endpoints.
"""

import pytest
from unittest.mock import patch, MagicMock


class TestSemanticSearchEndpoint:
    """Tests for POST /search/semantic endpoint."""

    @patch("src.search.service.SemanticSearchService.semantic_search")
    def test_semantic_search_success(self, mock_search, test_client, test_engine):
        """Test successful semantic search."""
        mock_search.return_value = {
            "movies": [
                {
                    "id": 1,
                    "movie_name": "Test Movie",
                    "rating": 8.5,
                    "runtime": 120,
                    "genre": "Action",
                    "metascore": 80,
                    "plot": "Test plot",
                    "directors": "Director",
                    "stars": "Star",
                    "votes": "100K",
                    "gross": "50M",
                    "poster_url": "http://test.com",
                    "similarity_score": 0.75,
                }
            ],
            "exact_matches": True,
            "message": "Movies found matching your query",
        }
        
        response = test_client.post(
            "/search/semantic",
            json={"query": "test query", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["exact_matches"] is True
        assert data["message"] == "Movies found matching your query"
        assert len(data["results"]) == 1
        assert data["results"][0]["similarity_score"] == 0.75

    @patch("src.search.service.SemanticSearchService.semantic_search")
    def test_semantic_search_no_exact_matches(self, mock_search, test_client, test_engine):
        """Test semantic search with no exact matches."""
        mock_search.return_value = {
            "movies": [
                {
                    "id": 1,
                    "movie_name": "Similar Movie",
                    "rating": 7.0,
                    "runtime": 100,
                    "genre": "Drama",
                    "metascore": 60,
                    "plot": "Similar plot",
                    "directors": "Director",
                    "stars": "Star",
                    "votes": "50K",
                    "gross": "20M",
                    "poster_url": None,
                    "similarity_score": 0.4,
                }
            ],
            "exact_matches": False,
            "message": "No exact matches found, but here are some similar movies",
        }
        
        response = test_client.post(
            "/search/semantic",
            json={"query": "obscure query", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["exact_matches"] is False
        assert "similar movies" in data["message"]

    def test_semantic_search_query_too_short(self, test_client, test_engine):
        """Test semantic search with query too short."""
        response = test_client.post(
            "/search/semantic",
            json={"query": "ab", "limit": 5}
        )
        
        assert response.status_code == 422  # Validation error

    def test_semantic_search_invalid_limit(self, test_client, test_engine):
        """Test semantic search with invalid limit."""
        response = test_client.post(
            "/search/semantic",
            json={"query": "test query", "limit": 0}
        )
        
        assert response.status_code == 422

    def test_semantic_search_missing_query(self, test_client, test_engine):
        """Test semantic search with missing query."""
        response = test_client.post(
            "/search/semantic",
            json={"limit": 5}
        )
        
        assert response.status_code == 422

    @patch("src.search.service.SemanticSearchService.semantic_search")
    def test_semantic_search_response_structure(self, mock_search, test_client, test_engine):
        """Test semantic search response has correct structure."""
        mock_search.return_value = {
            "movies": [],
            "exact_matches": False,
            "message": "No movies found",
        }
        
        response = test_client.post(
            "/search/semantic",
            json={"query": "test query", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert "query" in data
        assert "limit" in data
        assert "exact_matches" in data
        assert "message" in data


class TestHybridSearchEndpoint:
    """Tests for POST /search/hybrid endpoint."""

    @patch("src.search.service.SemanticSearchService.hybrid_search")
    def test_hybrid_search_success(self, mock_search, test_client, test_engine):
        """Test successful hybrid search."""
        mock_search.return_value = {
            "movies": [
                {
                    "id": 1,
                    "movie_name": "Test Movie",
                    "rating": 8.5,
                    "runtime": 120,
                    "genre": "Action",
                    "metascore": 80,
                    "plot": "Test plot",
                    "directors": "Director",
                    "stars": "Star",
                    "votes": "100K",
                    "gross": "50M",
                    "poster_url": "http://test.com",
                    "similarity_score": 0.65,
                }
            ],
            "exact_matches": True,
            "message": "Movies found matching your query",
        }
        
        response = test_client.post(
            "/search/hybrid",
            json={"query": "test query", "genre": "Action", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["exact_matches"] is True
        assert len(data["results"]) == 1

    @patch("src.search.service.SemanticSearchService.hybrid_search")
    def test_hybrid_search_with_all_filters(self, mock_search, test_client, test_engine):
        """Test hybrid search with all filters."""
        mock_search.return_value = {
            "movies": [],
            "exact_matches": False,
            "message": "No movies found matching your criteria",
        }
        
        response = test_client.post(
            "/search/hybrid",
            json={
                "query": "test query",
                "genre": "Action",
                "directors": "Nolan",
                "stars": "DiCaprio",
                "min_rating": 7.0,
                "max_rating": 9.5,
                "min_runtime": 90,
                "max_runtime": 180,
                "limit": 10
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "No movies found matching your criteria"

    def test_hybrid_search_query_required(self, test_client, test_engine):
        """Test hybrid search requires query."""
        response = test_client.post(
            "/search/hybrid",
            json={"genre": "Action", "limit": 5}
        )
        
        assert response.status_code == 422

    def test_hybrid_search_query_too_short(self, test_client, test_engine):
        """Test hybrid search with query too short."""
        response = test_client.post(
            "/search/hybrid",
            json={"query": "ab", "limit": 5}
        )
        
        assert response.status_code == 422

    def test_hybrid_search_invalid_rating(self, test_client, test_engine):
        """Test hybrid search with invalid rating."""
        response = test_client.post(
            "/search/hybrid",
            json={"query": "test query", "min_rating": 15.0}
        )
        
        assert response.status_code == 422

    @patch("src.search.service.SemanticSearchService.hybrid_search")
    def test_hybrid_search_response_structure(self, mock_search, test_client, test_engine):
        """Test hybrid search response has correct structure."""
        mock_search.return_value = {
            "movies": [],
            "exact_matches": False,
            "message": "No movies found matching your criteria",
        }
        
        response = test_client.post(
            "/search/hybrid",
            json={"query": "test query", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert set(data.keys()) == {"results", "query", "limit", "exact_matches", "message"}
