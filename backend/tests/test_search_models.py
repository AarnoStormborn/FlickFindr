"""
Unit tests for search models (Pydantic validation).
"""

import pytest
from pydantic import ValidationError

from src.search.models import (
    SortOrder,
    SortBy,
    StructuralSearchRequest,
    MovieResult,
    SearchResponse,
    MovieStats,
    GenreItem,
)


class TestSortEnums:
    """Tests for sort enums."""

    def test_sort_order_values(self):
        """Test SortOrder enum values."""
        assert SortOrder.ASC == "asc"
        assert SortOrder.DESC == "desc"

    def test_sort_by_values(self):
        """Test SortBy enum values."""
        assert SortBy.RATING == "rating"
        assert SortBy.RUNTIME == "runtime"
        assert SortBy.NAME == "movie_name"
        assert SortBy.METASCORE == "metascore"


class TestStructuralSearchRequest:
    """Tests for StructuralSearchRequest model."""

    def test_default_values(self):
        """Test default values are set correctly."""
        request = StructuralSearchRequest()
        assert request.query is None
        assert request.genre is None
        assert request.directors is None
        assert request.stars is None
        assert request.min_rating is None
        assert request.max_rating is None
        assert request.min_runtime is None
        assert request.max_runtime is None
        assert request.sort_by == SortBy.RATING
        assert request.sort_order == SortOrder.DESC
        assert request.skip == 0
        assert request.limit == 10

    def test_all_fields_populated(self):
        """Test creating request with all fields."""
        request = StructuralSearchRequest(
            query="test",
            genre="Action",
            directors="Nolan",
            stars="DiCaprio",
            min_rating=7.0,
            max_rating=9.5,
            min_runtime=90,
            max_runtime=180,
            sort_by=SortBy.RUNTIME,
            sort_order=SortOrder.ASC,
            skip=10,
            limit=20,
        )
        assert request.query == "test"
        assert request.genre == "Action"
        assert request.min_rating == 7.0
        assert request.limit == 20

    def test_rating_validation_min_boundary(self):
        """Test rating must be >= 0."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(min_rating=-1.0)

    def test_rating_validation_max_boundary(self):
        """Test rating must be <= 10."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(max_rating=11.0)

    def test_rating_valid_boundaries(self):
        """Test valid rating boundaries."""
        request = StructuralSearchRequest(min_rating=0.0, max_rating=10.0)
        assert request.min_rating == 0.0
        assert request.max_rating == 10.0

    def test_runtime_validation_negative(self):
        """Test runtime must be >= 0."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(min_runtime=-10)

    def test_skip_validation_negative(self):
        """Test skip must be >= 0."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(skip=-1)

    def test_limit_validation_zero(self):
        """Test limit must be >= 1."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(limit=0)

    def test_limit_validation_max(self):
        """Test limit must be <= 100."""
        with pytest.raises(ValidationError):
            StructuralSearchRequest(limit=101)

    def test_limit_valid_boundaries(self):
        """Test valid limit boundaries."""
        request = StructuralSearchRequest(limit=1)
        assert request.limit == 1
        request = StructuralSearchRequest(limit=100)
        assert request.limit == 100


class TestMovieResult:
    """Tests for MovieResult model."""

    def test_required_fields(self):
        """Test required fields."""
        result = MovieResult(id=1, movie_name="Test Movie")
        assert result.id == 1
        assert result.movie_name == "Test Movie"

    def test_optional_fields_none(self):
        """Test optional fields default to None."""
        result = MovieResult(id=1, movie_name="Test Movie")
        assert result.rating is None
        assert result.runtime is None
        assert result.genre is None
        assert result.metascore is None
        assert result.plot is None
        assert result.directors is None
        assert result.stars is None
        assert result.votes is None
        assert result.gross is None
        assert result.poster_url is None

    def test_all_fields_populated(self):
        """Test all fields can be populated."""
        result = MovieResult(
            id=1,
            movie_name="Test Movie",
            rating=8.5,
            runtime=120,
            genre="Action",
            metascore=75.0,
            plot="A test plot.",
            directors="Test Director",
            stars="Test Actor",
            votes="100K",
            gross="50M",
            poster_url="https://example.com/poster.jpg"
        )
        assert result.rating == 8.5
        assert result.runtime == 120
        assert result.poster_url == "https://example.com/poster.jpg"


class TestSearchResponse:
    """Tests for SearchResponse model."""

    def test_empty_results(self):
        """Test response with empty results."""
        response = SearchResponse(
            results=[],
            total=0,
            skip=0,
            limit=10,
            has_more=False
        )
        assert len(response.results) == 0
        assert response.total == 0
        assert response.has_more is False

    def test_with_results(self):
        """Test response with results."""
        movies = [
            MovieResult(id=1, movie_name="Movie 1"),
            MovieResult(id=2, movie_name="Movie 2"),
        ]
        response = SearchResponse(
            results=movies,
            total=100,
            skip=0,
            limit=10,
            has_more=True
        )
        assert len(response.results) == 2
        assert response.total == 100
        assert response.has_more is True


class TestMovieStats:
    """Tests for MovieStats model."""

    def test_all_fields(self):
        """Test all stats fields."""
        stats = MovieStats(
            min_rating=4.5,
            max_rating=9.5,
            min_runtime=60,
            max_runtime=300,
            total_movies=1000
        )
        assert stats.min_rating == 4.5
        assert stats.max_rating == 9.5
        assert stats.min_runtime == 60
        assert stats.max_runtime == 300
        assert stats.total_movies == 1000


class TestGenreItem:
    """Tests for GenreItem model."""

    def test_genre_item(self):
        """Test genre item creation."""
        genre = GenreItem(name="Action", count=250)
        assert genre.name == "Action"
        assert genre.count == 250
