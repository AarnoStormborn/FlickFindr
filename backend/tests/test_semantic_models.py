"""
Unit tests for semantic search models (Pydantic validation).
"""

import pytest
from pydantic import ValidationError

from src.search.models import (
    SemanticSearchRequest,
    HybridSearchRequest,
    SemanticSearchResponse,
    MovieResult,
)


class TestSemanticSearchRequest:
    """Tests for SemanticSearchRequest model."""

    def test_valid_request(self):
        """Test valid request creation."""
        request = SemanticSearchRequest(query="test query")
        assert request.query == "test query"
        assert request.limit == 10  # default

    def test_query_required(self):
        """Test query is required."""
        with pytest.raises(ValidationError):
            SemanticSearchRequest()

    def test_query_min_length(self):
        """Test query minimum length of 3."""
        with pytest.raises(ValidationError):
            SemanticSearchRequest(query="ab")

    def test_query_min_length_boundary(self):
        """Test query exactly at minimum length."""
        request = SemanticSearchRequest(query="abc")
        assert request.query == "abc"

    def test_limit_default(self):
        """Test default limit value."""
        request = SemanticSearchRequest(query="test query")
        assert request.limit == 10

    def test_limit_custom(self):
        """Test custom limit value."""
        request = SemanticSearchRequest(query="test", limit=50)
        assert request.limit == 50

    def test_limit_min_validation(self):
        """Test limit must be >= 1."""
        with pytest.raises(ValidationError):
            SemanticSearchRequest(query="test", limit=0)

    def test_limit_max_validation(self):
        """Test limit must be <= 100."""
        with pytest.raises(ValidationError):
            SemanticSearchRequest(query="test", limit=101)


class TestHybridSearchRequest:
    """Tests for HybridSearchRequest model."""

    def test_valid_request_minimal(self):
        """Test valid request with only required field."""
        request = HybridSearchRequest(query="test query")
        assert request.query == "test query"
        assert request.genre is None
        assert request.directors is None
        assert request.stars is None
        assert request.min_rating is None
        assert request.max_rating is None
        assert request.min_runtime is None
        assert request.max_runtime is None
        assert request.limit == 10

    def test_valid_request_with_filters(self):
        """Test valid request with all filters."""
        request = HybridSearchRequest(
            query="test query",
            genre="Action",
            directors="Nolan",
            stars="DiCaprio",
            min_rating=7.0,
            max_rating=9.5,
            min_runtime=90,
            max_runtime=180,
            limit=20,
        )
        assert request.genre == "Action"
        assert request.min_rating == 7.0
        assert request.max_runtime == 180

    def test_query_required(self):
        """Test query is required."""
        with pytest.raises(ValidationError):
            HybridSearchRequest()

    def test_query_min_length(self):
        """Test query minimum length of 3."""
        with pytest.raises(ValidationError):
            HybridSearchRequest(query="ab")

    def test_rating_validation(self):
        """Test rating range validation."""
        with pytest.raises(ValidationError):
            HybridSearchRequest(query="test", min_rating=-1.0)
        with pytest.raises(ValidationError):
            HybridSearchRequest(query="test", max_rating=11.0)

    def test_runtime_validation(self):
        """Test runtime must be positive."""
        with pytest.raises(ValidationError):
            HybridSearchRequest(query="test", min_runtime=-10)


class TestSemanticSearchResponse:
    """Tests for SemanticSearchResponse model."""

    def test_response_with_defaults(self):
        """Test response with default values."""
        response = SemanticSearchResponse(
            results=[],
            query="test",
            limit=10,
        )
        assert response.exact_matches is True  # default
        assert response.message == "Movies found matching your query"  # default

    def test_response_with_custom_values(self):
        """Test response with custom exact_matches and message."""
        response = SemanticSearchResponse(
            results=[],
            query="test",
            limit=10,
            exact_matches=False,
            message="No exact matches found",
        )
        assert response.exact_matches is False
        assert response.message == "No exact matches found"

    def test_response_with_results(self):
        """Test response with movie results."""
        movie = MovieResult(id=1, movie_name="Test Movie", similarity_score=0.8)
        response = SemanticSearchResponse(
            results=[movie],
            query="test",
            limit=10,
            exact_matches=True,
            message="Movies found matching your query",
        )
        assert len(response.results) == 1
        assert response.results[0].movie_name == "Test Movie"
        assert response.results[0].similarity_score == 0.8


class TestMovieResultSimilarityScore:
    """Tests for similarity_score field in MovieResult."""

    def test_similarity_score_none_by_default(self):
        """Test similarity_score is None by default."""
        result = MovieResult(id=1, movie_name="Test")
        assert result.similarity_score is None

    def test_similarity_score_can_be_set(self):
        """Test similarity_score can be set."""
        result = MovieResult(id=1, movie_name="Test", similarity_score=0.75)
        assert result.similarity_score == 0.75

    def test_similarity_score_float(self):
        """Test similarity_score accepts float values."""
        result = MovieResult(id=1, movie_name="Test", similarity_score=0.12345)
        assert result.similarity_score == 0.12345
