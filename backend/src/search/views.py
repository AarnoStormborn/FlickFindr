from typing import List

from fastapi import APIRouter, HTTPException

from ..db.core import DbSession
from ..logging import logger
from .models import (
    GenreItem,
    MovieResult,
    MovieStats,
    SearchResponse,
    StructuralSearchRequest,
)
from .service import StructuralSearchService

router = APIRouter(prefix="/search", tags=["Search"])


@router.post("/structural", response_model=SearchResponse)
async def structural_search(
    db: DbSession,
    request: StructuralSearchRequest,
) -> SearchResponse:
    """
    Advanced structural search with multiple filter options.

    Supports:
    - Text search on movie name
    - Filtering by genre, directors, stars
    - Rating and runtime range filters
    - Sorting by rating, runtime, name, metascore
    - Pagination
    """
    try:
        service = StructuralSearchService(db)
        results, total = service.execute_search(request)

        return SearchResponse(
            results=[MovieResult.model_validate(movie) for movie in results],
            total=total,
            skip=request.skip,
            limit=request.limit,
            has_more=(request.skip + len(results)) < total,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Structural search failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Search failed")


@router.get("/genres", response_model=List[GenreItem])
async def get_genres(db: DbSession) -> List[GenreItem]:
    """Get list of all unique genres with movie counts."""
    try:
        service = StructuralSearchService(db)
        return service.get_genres()

    except Exception as e:
        logger.error(f"Failed to get genres: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve genres")


@router.get("/stats", response_model=MovieStats)
async def get_stats(db: DbSession) -> MovieStats:
    """Get movie statistics (min/max values) for filter UI."""
    try:
        service = StructuralSearchService(db)
        return service.get_stats()

    except Exception as e:
        logger.error(f"Failed to get stats: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve statistics")
