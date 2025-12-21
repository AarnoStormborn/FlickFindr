"""
Script to generate embeddings for all movie plots and store them in PostgreSQL.
Run this script after pgvector extension is enabled and plot_embedding column is added.

Usage:
    python -m ingestion.generate_embeddings
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import psycopg2
from psycopg2.extras import execute_values
import numpy as np

from src.search.embedding import batch_generate_embeddings, EMBEDDING_DIM
from src.config import settings


def main():
    """Generate and store embeddings for all movie plots."""
    
    # Connect to database
    conn = psycopg2.connect(
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        user=settings.db_user,
        password=settings.db_password,
    )
    
    try:
        cur = conn.cursor()
        
        # Check if plot_embedding column exists, if not create it
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'movies' AND column_name = 'plot_embedding'
        """)
        if not cur.fetchone():
            print("Adding plot_embedding column...")
            cur.execute(f"ALTER TABLE movies ADD COLUMN plot_embedding vector({EMBEDDING_DIM})")
            conn.commit()
        
        # Fetch all movies with their plots
        print("Fetching movies...")
        cur.execute("SELECT id, plot FROM movies ORDER BY id")
        movies = cur.fetchall()
        print(f"Found {len(movies)} movies")
        
        if not movies:
            print("No movies found!")
            return
        
        # Extract plots
        movie_ids = [m[0] for m in movies]
        plots = [m[1] or "" for m in movies]
        
        # Generate embeddings in batches
        print("Generating embeddings...")
        embeddings = batch_generate_embeddings(plots, batch_size=64)
        
        # Update database with embeddings
        print("Storing embeddings in database...")
        
        # Prepare data for batch update
        update_data = []
        for movie_id, embedding in zip(movie_ids, embeddings):
            # Convert to string format for pgvector
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
            update_data.append((embedding_str, movie_id))
        
        # Batch update
        cur.executemany(
            "UPDATE movies SET plot_embedding = %s::vector WHERE id = %s",
            update_data
        )
        
        conn.commit()
        print(f"Successfully stored embeddings for {len(embeddings)} movies!")
        
        # Create index for faster similarity search
        print("Creating vector index...")
        cur.execute("""
            CREATE INDEX IF NOT EXISTS movies_plot_embedding_idx 
            ON movies USING ivfflat (plot_embedding vector_cosine_ops)
            WITH (lists = 100)
        """)
        conn.commit()
        print("Vector index created!")
        
        # Verify
        cur.execute("SELECT COUNT(*) FROM movies WHERE plot_embedding IS NOT NULL")
        count = cur.fetchone()[0]
        print(f"Verification: {count} movies have embeddings")
        
    finally:
        conn.close()
        print("Database connection closed.")


if __name__ == "__main__":
    main()
