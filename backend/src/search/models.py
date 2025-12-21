from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class SortOrder(str, Enum):
    ASC = "asc"
    DESC = "desc"


class SortBy(str, Enum):
    RATING = "rating"
    RUNTIME = "runtime"
    NAME = "movie_name"
    METASCORE = "metascore"
    SIMILARITY = "similarity"


class StructuralSearchRequest(BaseModel):
    """Request model for structural search with multiple filter options."""

    # Text search
    query: Optional[str] = Field(None, description="Search query for movie name")

    # Categorical filters
    genre: Optional[str] = Field(None, description="Filter by genre (partial match)")
    directors: Optional[str] = Field(None, description="Filter by director name (partial match)")
    stars: Optional[str] = Field(None, description="Filter by actor name (partial match)")

    # Range filters
    min_rating: Optional[float] = Field(None, ge=0, le=10, description="Minimum rating")
    max_rating: Optional[float] = Field(None, ge=0, le=10, description="Maximum rating")
    min_runtime: Optional[int] = Field(None, ge=0, description="Minimum runtime in minutes")
    max_runtime: Optional[int] = Field(None, description="Maximum runtime in minutes")

    # Sorting
    sort_by: SortBy = Field(SortBy.RATING, description="Field to sort by")
    sort_order: SortOrder = Field(SortOrder.DESC, description="Sort order")

    # Pagination
    skip: int = Field(0, ge=0, description="Number of results to skip")
    limit: int = Field(10, ge=1, le=100, description="Number of results to return")


class SemanticSearchRequest(BaseModel):
    """Request model for semantic search on plot descriptions."""

    query: str = Field(..., min_length=3, description="Natural language query describing the movie")
    limit: int = Field(10, ge=1, le=100, description="Number of results to return")


class HybridSearchRequest(BaseModel):
    """Request model for hybrid search combining structural filters and semantic ranking."""

    # Semantic query
    query: str = Field(..., min_length=3, description="Natural language query for semantic search")

    # Structural filters (optional)
    genre: Optional[str] = Field(None, description="Filter by genre")
    directors: Optional[str] = Field(None, description="Filter by director name")
    stars: Optional[str] = Field(None, description="Filter by actor name")
    min_rating: Optional[float] = Field(None, ge=0, le=10, description="Minimum rating")
    max_rating: Optional[float] = Field(None, ge=0, le=10, description="Maximum rating")
    min_runtime: Optional[int] = Field(None, ge=0, description="Minimum runtime in minutes")
    max_runtime: Optional[int] = Field(None, description="Maximum runtime in minutes")

    # Pagination
    limit: int = Field(10, ge=1, le=100, description="Number of results to return")


class MovieResult(BaseModel):
    """Movie result in search response."""

    id: int
    movie_name: str
    rating: Optional[float] = None
    runtime: Optional[int] = None
    genre: Optional[str] = None
    metascore: Optional[float] = None
    plot: Optional[str] = None
    directors: Optional[str] = None
    stars: Optional[str] = None
    votes: Optional[str] = None
    gross: Optional[str] = None
    poster_url: Optional[str] = None
    similarity_score: Optional[float] = Field(None, description="Semantic similarity score (0-1)")

    class Config:
        from_attributes = True


class SearchResponse(BaseModel):
    """Paginated search response with metadata."""

    results: List[MovieResult]
    total: int = Field(description="Total number of matching results")
    skip: int = Field(description="Number of results skipped")
    limit: int = Field(description="Number of results returned")
    has_more: bool = Field(description="Whether there are more results")


class SemanticSearchResponse(BaseModel):
    """Response for semantic search."""

    results: List[MovieResult]
    query: str = Field(description="Original search query")
    limit: int = Field(description="Number of results returned")
    exact_matches: bool = Field(
        True, 
        description="True if results are above similarity threshold, False if showing similar suggestions"
    )
    message: str = Field(
        "Movies found matching your query",
        description="User-facing message about the results"
    )


class MovieStats(BaseModel):
    """Statistics about movies for filter UI."""

    min_rating: float
    max_rating: float
    min_runtime: int
    max_runtime: int
    total_movies: int


class GenreItem(BaseModel):
    """Genre with movie count."""

    name: str
    count: int

