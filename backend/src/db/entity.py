from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Float, Integer, String, Text

from .core import Base


class Movie(Base):
    __tablename__ = "movies"

    id = Column(Integer, primary_key=True, index=True)
    movie_name = Column(String(255), index=True, nullable=False)
    rating = Column(Float, nullable=True)
    runtime = Column(Integer, nullable=True)
    genre = Column(Text, nullable=True)
    metascore = Column(Float, nullable=True)
    plot = Column(Text, nullable=True)
    directors = Column(Text, nullable=True)
    stars = Column(Text, nullable=True)
    votes = Column(String(20), nullable=True)
    gross = Column(String(20), nullable=True)
    poster_url = Column(Text, nullable=True)
    plot_embedding = Column(Vector(384), nullable=True)

    def __repr__(self):
        """Provides a helpful representation of the Movie object."""
        return f"<Movie(id={self.id}, name='{self.movie_name}', rating={self.rating})>"
