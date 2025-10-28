from typing import Optional

from pydantic import BaseModel


class MovieResponse(BaseModel):
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

    class Config:
        from_attributes = True
