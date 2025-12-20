### endpoints needed
# get all movies
# get movie by id
# filter movies based on critera

# need pagination

from typing import List

from fastapi import APIRouter, HTTPException, Query

from ..db.core import DbSession
from ..db.entity import Movie
from ..logging import logger
from .models import MovieResponse

router = APIRouter(prefix="/flicks")


@router.get("/")
async def get_movies(db: DbSession, skip: int = Query(ge=0), limit: int = Query(ge=0)) -> List[MovieResponse]:
    try:
        movies = db.query(Movie).offset(skip).limit(limit).all()
        if not movies:
            raise HTTPException(status_code=404, detail="Movies not found")
        logger.info("Movies fetched")
        return movies

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Could not fetch movies: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/movie/{movie_id}")
async def get_movie_by_id(
    db: DbSession,
    movie_id: int,
) -> MovieResponse:
    try:
        movie = db.query(Movie).filter(Movie.id == movie_id).first()
        if not movie:
            raise HTTPException(status_code=404, detail=f"Movie not found for ID: {movie_id}")
        logger.info(f"Found movie: {movie} for ID: {movie_id}")
        return MovieResponse.model_validate(movie)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching movie for ID: {movie_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/filter")
async def filter_movies(
    db: DbSession,
    genre: str = Query(None),
    directors: str = Query(None),
    stars: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=0),
):
    try:
        query = db.query(Movie)

        if genre:
            query = query.filter(Movie.genre.ilike(f"%{genre}%"))
        if directors:
            query = query.filter(Movie.directors.ilike(f"%{directors}%"))
        if stars:
            query = query.filter(Movie.stars.ilike(f"%{stars}%"))

        movies = query.offset(skip).limit(limit).all()

        if not movies:
            raise HTTPException(status_code=404, detail="No movies found for matching criteria")

        logger.info(f"Found {len(movies)} for criteria: {genre}")
        return movies

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching filtered movies: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
