from typing import List, Tuple

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..db.entity import Movie
from ..logging import logger
from .models import (
    GenreItem,
    HybridSearchRequest,
    MovieStats,
    SemanticSearchRequest,
    SortBy,
    SortOrder,
    StructuralSearchRequest,
)


class StructuralSearchService:
    """Service for building and executing structural search queries."""

    def __init__(self, db: Session):
        self.db = db

    def build_query(self, request: StructuralSearchRequest):
        """Build SQLAlchemy query from search request filters."""
        query = self.db.query(Movie)

        # Text search on movie name
        if request.query:
            query = query.filter(Movie.movie_name.ilike(f"%{request.query}%"))

        # Categorical filters (partial match)
        if request.genre:
            query = query.filter(Movie.genre.ilike(f"%{request.genre}%"))
        if request.directors:
            query = query.filter(Movie.directors.ilike(f"%{request.directors}%"))
        if request.stars:
            query = query.filter(Movie.stars.ilike(f"%{request.stars}%"))

        # Range filters
        if request.min_rating is not None:
            query = query.filter(Movie.rating >= request.min_rating)
        if request.max_rating is not None:
            query = query.filter(Movie.rating <= request.max_rating)
        if request.min_runtime is not None:
            query = query.filter(Movie.runtime >= request.min_runtime)
        if request.max_runtime is not None:
            query = query.filter(Movie.runtime <= request.max_runtime)

        return query

    def apply_sorting(self, query, request: StructuralSearchRequest):
        """Apply sorting to the query."""
        sort_column = getattr(Movie, request.sort_by.value)

        if request.sort_order == SortOrder.DESC:
            query = query.order_by(sort_column.desc().nulls_last())
        else:
            query = query.order_by(sort_column.asc().nulls_last())

        return query

    def execute_search(self, request: StructuralSearchRequest) -> Tuple[List[Movie], int]:
        """Execute search and return results with total count."""
        try:
            # Build base query with filters
            query = self.build_query(request)

            # Get total count before pagination
            total = query.count()

            # Apply sorting
            query = self.apply_sorting(query, request)

            # Apply pagination
            results = query.offset(request.skip).limit(request.limit).all()

            logger.info(
                f"Search executed: {len(results)} results returned, {total} total matches"
            )

            return results, total

        except Exception as e:
            logger.error(f"Search execution failed: {str(e)}")
            raise

    def get_genres(self) -> List[GenreItem]:
        """Get list of unique genres with movie counts."""
        try:
            # Get all genres (they are comma-separated in the genre field)
            movies = self.db.query(Movie.genre).filter(Movie.genre.isnot(None)).all()

            # Parse and count genres
            genre_counts: dict = {}
            for (genre_str,) in movies:
                if genre_str:
                    for genre in genre_str.split(","):
                        genre = genre.strip()
                        if genre:
                            genre_counts[genre] = genre_counts.get(genre, 0) + 1

            # Sort by count descending
            sorted_genres = sorted(genre_counts.items(), key=lambda x: x[1], reverse=True)

            return [GenreItem(name=name, count=count) for name, count in sorted_genres]

        except Exception as e:
            logger.error(f"Failed to get genres: {str(e)}")
            raise

    def get_stats(self) -> MovieStats:
        """Get movie statistics for filter UI."""
        try:
            stats = self.db.query(
                func.min(Movie.rating).label("min_rating"),
                func.max(Movie.rating).label("max_rating"),
                func.min(Movie.runtime).label("min_runtime"),
                func.max(Movie.runtime).label("max_runtime"),
                func.count(Movie.id).label("total_movies"),
            ).first()

            return MovieStats(
                min_rating=stats.min_rating or 0.0,
                max_rating=stats.max_rating or 10.0,
                min_runtime=stats.min_runtime or 0,
                max_runtime=stats.max_runtime or 300,
                total_movies=stats.total_movies or 0,
            )

        except Exception as e:
            logger.error(f"Failed to get stats: {str(e)}")
            raise


class SemanticSearchService:
    """Service for semantic search using vector embeddings."""
    
    # Similarity threshold - results below this are considered "similar suggestions"
    SIMILARITY_THRESHOLD = 0.6

    def __init__(self, db: Session):
        self.db = db

    def semantic_search(self, request: SemanticSearchRequest) -> dict:
        """
        Perform semantic search using cosine similarity on plot embeddings.
        
        Returns dict with movies, exact_matches flag, and message.
        """
        try:
            from .embedding import generate_embedding
            
            # Generate embedding for the query
            query_embedding = generate_embedding(request.query)
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
            
            # Use raw SQL for vector similarity search
            # 1 - cosine distance = cosine similarity (0 to 1)
            sql = text("""
                SELECT 
                    id, movie_name, rating, runtime, genre, metascore, 
                    plot, directors, stars, votes, gross, poster_url,
                    1 - (plot_embedding <=> CAST(:embedding AS vector)) as similarity_score
                FROM movies 
                WHERE plot_embedding IS NOT NULL
                ORDER BY plot_embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
            """)
            
            result = self.db.execute(sql, {"embedding": embedding_str, "limit": request.limit})
            
            movies = []
            for row in result:
                movies.append({
                    "id": row.id,
                    "movie_name": row.movie_name,
                    "rating": row.rating,
                    "runtime": row.runtime,
                    "genre": row.genre,
                    "metascore": row.metascore,
                    "plot": row.plot,
                    "directors": row.directors,
                    "stars": row.stars,
                    "votes": row.votes,
                    "gross": row.gross,
                    "poster_url": row.poster_url,
                    "similarity_score": round(float(row.similarity_score), 4) if row.similarity_score else None,
                })
            
            # Check if any results are above the threshold
            exact_matches = any(
                m["similarity_score"] and m["similarity_score"] >= self.SIMILARITY_THRESHOLD 
                for m in movies
            )
            
            if exact_matches:
                message = "Movies found matching your query"
            elif movies:
                message = "No exact matches found, but here are some similar movies"
            else:
                message = "No movies found"
            
            logger.info(f"Semantic search returned {len(movies)} results (exact_matches={exact_matches}) for query: {request.query[:50]}...")
            
            return {
                "movies": movies,
                "exact_matches": exact_matches,
                "message": message,
            }
            
        except Exception as e:
            logger.error(f"Semantic search failed: {str(e)}")
            raise

    def hybrid_search(self, request: HybridSearchRequest) -> dict:
        """
        Perform hybrid search: apply structural filters, then rank by semantic similarity.
        
        Returns dict with movies, exact_matches flag, and message.
        """
        try:
            from .embedding import generate_embedding
            
            # Generate embedding for the query
            query_embedding = generate_embedding(request.query)
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
            
            # Build WHERE clauses for structural filters
            where_clauses = ["plot_embedding IS NOT NULL"]
            params = {"embedding": embedding_str, "limit": request.limit}
            
            if request.genre:
                where_clauses.append("genre ILIKE :genre")
                params["genre"] = f"%{request.genre}%"
            if request.directors:
                where_clauses.append("directors ILIKE :directors")
                params["directors"] = f"%{request.directors}%"
            if request.stars:
                where_clauses.append("stars ILIKE :stars")
                params["stars"] = f"%{request.stars}%"
            if request.min_rating is not None:
                where_clauses.append("rating >= :min_rating")
                params["min_rating"] = request.min_rating
            if request.max_rating is not None:
                where_clauses.append("rating <= :max_rating")
                params["max_rating"] = request.max_rating
            if request.min_runtime is not None:
                where_clauses.append("runtime >= :min_runtime")
                params["min_runtime"] = request.min_runtime
            if request.max_runtime is not None:
                where_clauses.append("runtime <= :max_runtime")
                params["max_runtime"] = request.max_runtime
            
            where_sql = " AND ".join(where_clauses)
            
            sql = text(f"""
                SELECT 
                    id, movie_name, rating, runtime, genre, metascore, 
                    plot, directors, stars, votes, gross, poster_url,
                    1 - (plot_embedding <=> CAST(:embedding AS vector)) as similarity_score
                FROM movies 
                WHERE {where_sql}
                ORDER BY plot_embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
            """)
            
            result = self.db.execute(sql, params)
            
            movies = []
            for row in result:
                movies.append({
                    "id": row.id,
                    "movie_name": row.movie_name,
                    "rating": row.rating,
                    "runtime": row.runtime,
                    "genre": row.genre,
                    "metascore": row.metascore,
                    "plot": row.plot,
                    "directors": row.directors,
                    "stars": row.stars,
                    "votes": row.votes,
                    "gross": row.gross,
                    "poster_url": row.poster_url,
                    "similarity_score": round(float(row.similarity_score), 4) if row.similarity_score else None,
                })
            
            # Check if any results are above the threshold
            exact_matches = any(
                m["similarity_score"] and m["similarity_score"] >= self.SIMILARITY_THRESHOLD 
                for m in movies
            )
            
            if exact_matches:
                message = "Movies found matching your query"
            elif movies:
                message = "No exact matches found, but here are some similar movies"
            else:
                message = "No movies found matching your criteria"
            
            logger.info(f"Hybrid search returned {len(movies)} results (exact_matches={exact_matches}) for query: {request.query[:50]}...")
            
            return {
                "movies": movies,
                "exact_matches": exact_matches,
                "message": message,
            }
            
        except Exception as e:
            logger.error(f"Hybrid search failed: {str(e)}")
            raise


