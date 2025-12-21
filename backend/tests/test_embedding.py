"""
Unit tests for embedding service.
"""

import pytest
from unittest.mock import patch, MagicMock
import numpy as np

from src.search.embedding import (
    generate_embedding,
    batch_generate_embeddings,
    EMBEDDING_DIM,
)


class TestEmbeddingConstants:
    """Tests for embedding constants."""

    def test_embedding_dim_value(self):
        """Test EMBEDDING_DIM is correct."""
        assert EMBEDDING_DIM == 384


class TestGenerateEmbedding:
    """Tests for generate_embedding function."""

    def test_empty_string_returns_zero_vector(self):
        """Test empty string returns zero vector."""
        result = generate_embedding("")
        assert len(result) == 384
        assert all(x == 0.0 for x in result)

    def test_whitespace_only_returns_zero_vector(self):
        """Test whitespace-only string returns zero vector."""
        result = generate_embedding("   ")
        assert len(result) == 384
        assert all(x == 0.0 for x in result)

    @patch("src.search.embedding.get_model")
    def test_valid_text_calls_model(self, mock_get_model):
        """Test valid text calls the model's encode method."""
        mock_model = MagicMock()
        mock_model.encode.return_value = np.zeros(384)
        mock_get_model.return_value = mock_model

        result = generate_embedding("test query")

        mock_model.encode.assert_called_once()
        assert len(result) == 384

    @patch("src.search.embedding.get_model")
    def test_returns_list_of_floats(self, mock_get_model):
        """Test result is a list of floats."""
        mock_model = MagicMock()
        mock_model.encode.return_value = np.array([0.1] * 384)
        mock_get_model.return_value = mock_model

        result = generate_embedding("test")

        assert isinstance(result, list)
        assert all(isinstance(x, float) for x in result)


class TestBatchGenerateEmbeddings:
    """Tests for batch_generate_embeddings function."""

    @patch("src.search.embedding.get_model")
    def test_batch_generation(self, mock_get_model):
        """Test batch embedding generation."""
        mock_model = MagicMock()
        mock_model.encode.return_value = np.array([[0.1] * 384, [0.2] * 384])
        mock_get_model.return_value = mock_model

        texts = ["text 1", "text 2"]
        result = batch_generate_embeddings(texts, batch_size=32)

        assert len(result) == 2
        assert all(len(emb) == 384 for emb in result)

    @patch("src.search.embedding.get_model")
    def test_empty_text_in_batch_returns_zero_vector(self, mock_get_model):
        """Test empty texts in batch get zero vectors."""
        mock_model = MagicMock()
        # Return embeddings for non-empty texts
        mock_model.encode.return_value = np.array([[0.1] * 384, [0.0] * 384, [0.3] * 384])
        mock_get_model.return_value = mock_model

        texts = ["text 1", "", "text 3"]
        result = batch_generate_embeddings(texts)

        assert len(result) == 3
        # Empty text should get zero vector
        assert all(x == 0.0 for x in result[1])

    @patch("src.search.embedding.get_model")
    def test_none_in_batch_replaced_with_empty_string(self, mock_get_model):
        """Test None values in batch are handled."""
        mock_model = MagicMock()
        mock_model.encode.return_value = np.array([[0.1] * 384, [0.0] * 384])
        mock_get_model.return_value = mock_model

        texts = ["text 1", None]
        result = batch_generate_embeddings(texts)

        assert len(result) == 2
        # None should get zero vector
        assert all(x == 0.0 for x in result[1])
