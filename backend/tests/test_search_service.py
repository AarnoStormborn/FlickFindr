"""
Unit tests for StructuralSearchService.
"""

import pytest
from unittest.mock import MagicMock, patch

from src.search.service import StructuralSearchService
from src.search.models import (
    StructuralSearchRequest,
    SortBy,
    SortOrder,
    GenreItem,
    MovieStats,
)
from src.db.entity import Movie


class TestStructuralSearchServiceBuildQuery:
    """Tests for StructuralSearchService.build_query method."""

    def test_build_query_no_filters(self, test_db, sample_movies):
        """Test building query with no filters returns all movies."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest()
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 5

    def test_build_query_with_text_search(self, test_db, sample_movies):
        """Test query filter on movie name."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(query="Godfather")
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 1
        assert results[0].movie_name == "The Godfather"

    def test_build_query_with_genre_filter(self, test_db, sample_movies):
        """Test query filter on genre."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(genre="Action")
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 2  # Dark Knight and Inception
        for movie in results:
            assert "Action" in movie.genre

    def test_build_query_with_directors_filter(self, test_db, sample_movies):
        """Test query filter on directors."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(directors="Nolan")
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 2  # Dark Knight and Inception

    def test_build_query_with_stars_filter(self, test_db, sample_movies):
        """Test query filter on stars."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(stars="Morgan Freeman")
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 1
        assert results[0].movie_name == "The Shawshank Redemption"

    def test_build_query_with_min_rating(self, test_db, sample_movies):
        """Test query filter with minimum rating."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(min_rating=9.0)
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 3  # Shawshank 9.3, Godfather 9.2, Dark Knight 9.0
        for movie in results:
            assert movie.rating >= 9.0

    def test_build_query_with_max_rating(self, test_db, sample_movies):
        """Test query filter with maximum rating."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(max_rating=8.9)
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 2  # Inception 8.8, Pulp Fiction 8.9
        for movie in results:
            assert movie.rating <= 8.9

    def test_build_query_with_rating_range(self, test_db, sample_movies):
        """Test query filter with rating range."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(min_rating=8.8, max_rating=9.0)
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 3  # Inception 8.8, Pulp Fiction 8.9, Dark Knight 9.0

    def test_build_query_with_min_runtime(self, test_db, sample_movies):
        """Test query filter with minimum runtime."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(min_runtime=150)
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 3  # Dark Knight 152, Pulp Fiction 154, Godfather 175
        for movie in results:
            assert movie.runtime >= 150

    def test_build_query_with_max_runtime(self, test_db, sample_movies):
        """Test query filter with maximum runtime."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(max_runtime=145)
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 1  # Shawshank 142
        for movie in results:
            assert movie.runtime <= 145

    def test_build_query_combined_filters(self, test_db, sample_movies):
        """Test query with multiple filters combined."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(
            genre="Crime",
            min_rating=9.0,
        )
        query = service.build_query(request)
        results = query.all()
        assert len(results) == 2  # Dark Knight 9.0, Godfather 9.2


class TestStructuralSearchServiceSorting:
    """Tests for StructuralSearchService.apply_sorting method."""

    def test_sort_by_rating_desc(self, test_db, sample_movies):
        """Test sorting by rating descending."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(sort_by=SortBy.RATING, sort_order=SortOrder.DESC)
        query = service.build_query(request)
        query = service.apply_sorting(query, request)
        results = query.all()
        assert results[0].rating == 9.3  # Shawshank
        assert results[1].rating == 9.2  # Godfather

    def test_sort_by_rating_asc(self, test_db, sample_movies):
        """Test sorting by rating ascending."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(sort_by=SortBy.RATING, sort_order=SortOrder.ASC)
        query = service.build_query(request)
        query = service.apply_sorting(query, request)
        results = query.all()
        assert results[0].rating == 8.8  # Inception

    def test_sort_by_runtime_desc(self, test_db, sample_movies):
        """Test sorting by runtime descending."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(sort_by=SortBy.RUNTIME, sort_order=SortOrder.DESC)
        query = service.build_query(request)
        query = service.apply_sorting(query, request)
        results = query.all()
        assert results[0].runtime == 175  # Godfather

    def test_sort_by_name_asc(self, test_db, sample_movies):
        """Test sorting by name ascending."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(sort_by=SortBy.NAME, sort_order=SortOrder.ASC)
        query = service.build_query(request)
        query = service.apply_sorting(query, request)
        results = query.all()
        assert results[0].movie_name == "Inception"

    def test_sort_by_metascore_desc(self, test_db, sample_movies):
        """Test sorting by metascore descending."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(sort_by=SortBy.METASCORE, sort_order=SortOrder.DESC)
        query = service.build_query(request)
        query = service.apply_sorting(query, request)
        results = query.all()
        assert results[0].metascore == 100.0  # Godfather


class TestStructuralSearchServiceExecuteSearch:
    """Tests for StructuralSearchService.execute_search method."""

    def test_execute_search_returns_results_and_total(self, test_db, sample_movies):
        """Test execute_search returns results and total count."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(limit=10)
        results, total = service.execute_search(request)
        assert len(results) == 5
        assert total == 5

    def test_execute_search_with_pagination(self, test_db, sample_movies):
        """Test execute_search with pagination."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(skip=2, limit=2)
        results, total = service.execute_search(request)
        assert len(results) == 2
        assert total == 5  # Total count should still be 5

    def test_execute_search_with_filter_and_pagination(self, test_db, sample_movies):
        """Test execute_search with filter and pagination."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(genre="Drama", skip=1, limit=2)
        results, total = service.execute_search(request)
        assert len(results) == 2
        assert total == 4  # 4 movies have Drama in genre

    def test_execute_search_empty_results(self, test_db, sample_movies):
        """Test execute_search with no matches."""
        service = StructuralSearchService(test_db)
        request = StructuralSearchRequest(query="NonExistentMovie")
        results, total = service.execute_search(request)
        assert len(results) == 0
        assert total == 0


class TestStructuralSearchServiceGenres:
    """Tests for StructuralSearchService.get_genres method."""

    def test_get_genres(self, test_db, sample_movies):
        """Test getting unique genres with counts."""
        service = StructuralSearchService(test_db)
        genres = service.get_genres()
        
        assert len(genres) > 0
        assert all(isinstance(g, GenreItem) for g in genres)
        
        # Check Drama is most common (4 movies)
        genre_dict = {g.name: g.count for g in genres}
        assert "Drama" in genre_dict
        assert genre_dict["Drama"] == 4

    def test_get_genres_sorted_by_count(self, test_db, sample_movies):
        """Test genres are sorted by count descending."""
        service = StructuralSearchService(test_db)
        genres = service.get_genres()
        
        counts = [g.count for g in genres]
        assert counts == sorted(counts, reverse=True)


class TestStructuralSearchServiceStats:
    """Tests for StructuralSearchService.get_stats method."""

    def test_get_stats(self, test_db, sample_movies):
        """Test getting movie statistics."""
        service = StructuralSearchService(test_db)
        stats = service.get_stats()
        
        assert isinstance(stats, MovieStats)
        assert stats.min_rating == 8.8  # Inception
        assert stats.max_rating == 9.3  # Shawshank
        assert stats.min_runtime == 142  # Shawshank
        assert stats.max_runtime == 175  # Godfather
        assert stats.total_movies == 5

    def test_get_stats_empty_database(self, test_db):
        """Test getting stats with empty database."""
        service = StructuralSearchService(test_db)
        stats = service.get_stats()
        
        # Should return default values
        assert stats.min_rating == 0.0
        assert stats.max_rating == 10.0
        assert stats.min_runtime == 0
        assert stats.max_runtime == 300
        assert stats.total_movies == 0
