from typing import List, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.entity import Movie
from ..logging import logger
from .models import (
    GenreItem,
    MovieStats,
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
