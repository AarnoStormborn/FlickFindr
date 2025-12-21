"""
Embedding generation service using sentence-transformers.
"""

from typing import List, Optional
import numpy as np

from ..logging import logger

# Lazy loading of model to avoid slow import times
_model = None


def get_model():
    """Load the embedding model (lazy loading)."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading embedding model: all-MiniLM-L6-v2")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded successfully")
    return _model


def generate_embedding(text: str) -> List[float]:
    """
    Generate embedding for a single text.
    
    Args:
        text: Input text to embed
        
    Returns:
        List of floats representing the embedding (384 dimensions)
    """
    if not text or not text.strip():
        # Return zero vector for empty text
        return [0.0] * 384
    
    model = get_model()
    embedding = model.encode(text, convert_to_numpy=True)
    return embedding.tolist()


def batch_generate_embeddings(texts: List[str], batch_size: int = 32) -> List[List[float]]:
    """
    Generate embeddings for multiple texts efficiently.
    
    Args:
        texts: List of texts to embed
        batch_size: Batch size for processing
        
    Returns:
        List of embedding vectors
    """
    model = get_model()
    
    # Replace None/empty with placeholder
    processed_texts = [t if t and t.strip() else "" for t in texts]
    
    logger.info(f"Generating embeddings for {len(texts)} texts...")
    embeddings = model.encode(
        processed_texts,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True
    )
    
    # Replace zero vectors for empty texts
    result = []
    for i, text in enumerate(processed_texts):
        if not text:
            result.append([0.0] * 384)
        else:
            result.append(embeddings[i].tolist())
    
    logger.info(f"Generated {len(result)} embeddings")
    return result


# Embedding dimension constant
EMBEDDING_DIM = 384
