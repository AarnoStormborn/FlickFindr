"""
Unit tests for SemanticSearchService.
"""

import pytest
from unittest.mock import patch, MagicMock

from src.search.service import SemanticSearchService
from src.search.models import SemanticSearchRequest, HybridSearchRequest


class TestSemanticSearchServiceThreshold:
    """Tests for SemanticSearchService threshold logic."""

    def test_similarity_threshold_value(self):
        """Test SIMILARITY_THRESHOLD is correct."""
        assert SemanticSearchService.SIMILARITY_THRESHOLD == 0.6


class TestSemanticSearchServiceSemanticSearch:
    """Tests for SemanticSearchService.semantic_search method."""

    @patch("src.search.embedding.generate_embedding")
    def test_semantic_search_exact_matches_true(self, mock_embed, test_db, test_engine):
        """Test exact_matches is True when similarity >= threshold."""
        mock_embed.return_value = [0.1] * 384
        
        # Mock db.execute to return high similarity results
        mock_result = [
            MagicMock(
                id=1, movie_name="Test Movie", rating=8.5, runtime=120,
                genre="Action", metascore=80, plot="Test plot",
                directors="Test Director", stars="Test Star",
                votes="100K", gross="50M", poster_url="http://test.com",
                similarity_score=0.75,  # Above threshold
            )
        ]
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = SemanticSearchRequest(query="test query", limit=5)
            result = service.semantic_search(request)
        
            assert result["exact_matches"] is True
            assert result["message"] == "Movies found matching your query"
            assert len(result["movies"]) == 1

    @patch("src.search.embedding.generate_embedding")
    def test_semantic_search_exact_matches_false(self, mock_embed, test_db, test_engine):
        """Test exact_matches is False when similarity < threshold."""
        mock_embed.return_value = [0.1] * 384
        
        mock_result = [
            MagicMock(
                id=1, movie_name="Test Movie", rating=8.5, runtime=120,
                genre="Action", metascore=80, plot="Test plot",
                directors="Test Director", stars="Test Star",
                votes="100K", gross="50M", poster_url="http://test.com",
                similarity_score=0.5,  # Below threshold
            )
        ]
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = SemanticSearchRequest(query="test query", limit=5)
            result = service.semantic_search(request)
        
            assert result["exact_matches"] is False
            assert result["message"] == "No exact matches found, but here are some similar movies"

    @patch("src.search.embedding.generate_embedding")
    def test_semantic_search_no_results(self, mock_embed, test_db, test_engine):
        """Test message when no results found."""
        mock_embed.return_value = [0.1] * 384
        
        with patch.object(test_db, 'execute', return_value=[]):
            service = SemanticSearchService(test_db)
            request = SemanticSearchRequest(query="test query", limit=5)
            result = service.semantic_search(request)
        
            assert result["exact_matches"] is False
            assert result["message"] == "No movies found"
            assert len(result["movies"]) == 0

    @patch("src.search.embedding.generate_embedding")
    def test_semantic_search_threshold_boundary(self, mock_embed, test_db, test_engine):
        """Test exact_matches at threshold boundary (0.6 exactly)."""
        mock_embed.return_value = [0.1] * 384
        
        mock_result = [
            MagicMock(
                id=1, movie_name="Test Movie", rating=8.5, runtime=120,
                genre="Action", metascore=80, plot="Test plot",
                directors="Test Director", stars="Test Star",
                votes="100K", gross="50M", poster_url="http://test.com",
                similarity_score=0.6,  # Exactly at threshold
            )
        ]
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = SemanticSearchRequest(query="test query", limit=5)
            result = service.semantic_search(request)
        
            assert result["exact_matches"] is True  # >= threshold


class TestSemanticSearchServiceHybridSearch:
    """Tests for SemanticSearchService.hybrid_search method."""

    @patch("src.search.embedding.generate_embedding")
    def test_hybrid_search_with_genre_filter(self, mock_embed, test_db, test_engine):
        """Test hybrid search with genre filter."""
        mock_embed.return_value = [0.1] * 384
        
        mock_result = [
            MagicMock(
                id=1, movie_name="Action Movie", rating=8.5, runtime=120,
                genre="Action", metascore=80, plot="Action plot",
                directors="Director", stars="Star",
                votes="100K", gross="50M", poster_url="http://test.com",
                similarity_score=0.7,
            )
        ]
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = HybridSearchRequest(query="action movie", genre="Action", limit=5)
            result = service.hybrid_search(request)
        
            assert result["exact_matches"] is True
            assert len(result["movies"]) == 1

    @patch("src.search.embedding.generate_embedding")
    def test_hybrid_search_with_rating_filter(self, mock_embed, test_db, test_engine):
        """Test hybrid search with rating range filter."""
        mock_embed.return_value = [0.1] * 384
        
        mock_result = []
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = HybridSearchRequest(
                query="test movie",
                min_rating=8.0,
                max_rating=9.5,
                limit=5
            )
            result = service.hybrid_search(request)
        
            assert result["message"] == "No movies found matching your criteria"

    @patch("src.search.embedding.generate_embedding")
    def test_hybrid_search_with_all_filters(self, mock_embed, test_db, test_engine):
        """Test hybrid search with all filters applied."""
        mock_embed.return_value = [0.1] * 384
        
        mock_result = [
            MagicMock(
                id=1, movie_name="Test Movie", rating=8.5, runtime=120,
                genre="Action", metascore=80, plot="Test plot",
                directors="Test Director", stars="Test Star",
                votes="100K", gross="50M", poster_url="http://test.com",
                similarity_score=0.4,  # Below threshold
            )
        ]
        
        with patch.object(test_db, 'execute', return_value=mock_result):
            service = SemanticSearchService(test_db)
            request = HybridSearchRequest(
                query="test",
                genre="Action",
                directors="Director",
                stars="Star",
                min_rating=7.0,
                max_rating=9.0,
                min_runtime=90,
                max_runtime=180,
                limit=10
            )
            result = service.hybrid_search(request)
        
            assert result["exact_matches"] is False
            assert "similar movies" in result["message"]

    @patch("src.search.embedding.generate_embedding")
    def test_hybrid_search_error_handling(self, mock_embed, test_db, test_engine):
        """Test hybrid search handles exceptions."""
        mock_embed.side_effect = Exception("Embedding error")
        
        service = SemanticSearchService(test_db)
        request = HybridSearchRequest(query="test query", limit=5)
        
        with pytest.raises(Exception):
            service.hybrid_search(request)
