"""
Pytest fixtures and configuration for FlickFindr tests.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from src.db.core import Base, get_db
from src.db.entity import Movie
from main import app


# Test database setup - use in-memory SQLite with StaticPool for thread safety
TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="function")
def test_engine():
    """Create a test database engine."""
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def test_db(test_engine):
    """Create a test database session."""
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def test_client(test_engine):
    """Create a test client with test database."""
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    app.dependency_overrides[get_db] = override_get_db
    
    with TestClient(app) as client:
        yield client
    
    app.dependency_overrides.clear()


@pytest.fixture
def sample_movies(test_db):
    """Insert sample movies for testing."""
    movies = [
        Movie(
            id=1,
            movie_name="The Shawshank Redemption",
            rating=9.3,
            runtime=142,
            genre="Drama",
            metascore=82.0,
            plot="Two imprisoned men bond over a number of years.",
            directors="Frank Darabont",
            stars="Tim Robbins, Morgan Freeman",
            votes="2.8M",
            gross="28.3M",
            poster_url="https://example.com/shawshank.jpg"
        ),
        Movie(
            id=2,
            movie_name="The Dark Knight",
            rating=9.0,
            runtime=152,
            genre="Action, Crime, Drama",
            metascore=84.0,
            plot="Batman battles the Joker in Gotham City.",
            directors="Christopher Nolan",
            stars="Christian Bale, Heath Ledger",
            votes="2.7M",
            gross="534.9M",
            poster_url="https://example.com/darkknight.jpg"
        ),
        Movie(
            id=3,
            movie_name="Inception",
            rating=8.8,
            runtime=148,
            genre="Action, Adventure, Sci-Fi",
            metascore=74.0,
            plot="A thief who steals corporate secrets through dream-sharing technology.",
            directors="Christopher Nolan",
            stars="Leonardo DiCaprio, Joseph Gordon-Levitt",
            votes="2.4M",
            gross="292.6M",
            poster_url="https://example.com/inception.jpg"
        ),
        Movie(
            id=4,
            movie_name="The Godfather",
            rating=9.2,
            runtime=175,
            genre="Crime, Drama",
            metascore=100.0,
            plot="The aging patriarch of an organized crime dynasty transfers control.",
            directors="Francis Ford Coppola",
            stars="Marlon Brando, Al Pacino",
            votes="1.9M",
            gross="135.0M",
            poster_url="https://example.com/godfather.jpg"
        ),
        Movie(
            id=5,
            movie_name="Pulp Fiction",
            rating=8.9,
            runtime=154,
            genre="Crime, Drama",
            metascore=94.0,
            plot="The lives of two mob hitmen intertwine in four tales of violence.",
            directors="Quentin Tarantino",
            stars="John Travolta, Uma Thurman",
            votes="2.1M",
            gross="107.9M",
            poster_url="https://example.com/pulpfiction.jpg"
        ),
    ]
    
    for movie in movies:
        test_db.add(movie)
    test_db.commit()
    
    return movies

