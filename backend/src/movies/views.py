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
        logger.info(f"SKIP: {skip}\tLIMIT: {limit}")
        movies = db.query(Movie).all()
        if not movies:
            raise HTTPException(status_code=404, detail="Movies not found")

        logger.info("Movies fetched")
        return movies[skip : skip + limit]

    except Exception as e:
        logger.error(f"Could not fetch movies: {str(e)}")


@router.get("/{movie_id}")
async def get_movie_by_id(
    db: DbSession,
    movie_id: int,
) -> MovieResponse:
    try:
        movie = db.query(Movie).filter(Movie.id == movie_id).first()
        if not movie:
            raise HTTPException(status_code=404, detail=f"Movie not found for ID: {movie_id}")
        logger.info(f"Found movie: {movie} for ID: {movie_id}")
        return MovieResponse.validate(movie)

    except HTTPException as e:
        logger.error(f"No movie found for ID: {movie_id}: {e}")
