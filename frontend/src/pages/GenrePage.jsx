import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import { searchMovies } from '../api/movies';
import './GenrePage.css';

export default function GenrePage() {
    const { name } = useParams();
    const navigate = useNavigate();
    const [movies, setMovies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [sortBy, setSortBy] = useState('rating');
    const [sortOrder, setSortOrder] = useState('desc');

    const MOVIES_PER_PAGE = 20;

    // Format genre name for display
    const formatGenreName = (genre) => {
        if (!genre) return '';
        return genre.charAt(0).toUpperCase() + genre.slice(1);
    };

    // Fetch movies
    useEffect(() => {
        const fetchMovies = async () => {
            try {
                setLoading(true);
                const response = await searchMovies({
                    genre: name,
                    sortBy,
                    sortOrder,
                    skip: page * MOVIES_PER_PAGE,
                    limit: MOVIES_PER_PAGE,
                });
                setMovies(response.results);
                setTotal(response.total);
            } catch (err) {
                console.error('Failed to fetch movies:', err);
                setError('Failed to load movies');
            } finally {
                setLoading(false);
            }
        };

        fetchMovies();
    }, [name, page, sortBy, sortOrder]);

    const handleSortChange = (newSortBy) => {
        if (newSortBy === sortBy) {
            // Toggle order
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(newSortBy);
            setSortOrder('desc');
        }
        setPage(0); // Reset to first page
    };

    const totalPages = Math.ceil(total / MOVIES_PER_PAGE);

    return (
        <div className="genre-page">
            {/* Back Button */}
            <button className="back-button" onClick={() => navigate('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            {/* Header */}
            <header className="genre-header">
                <h1 className="genre-title">{formatGenreName(name)} Movies</h1>
                <p className="genre-count">{total.toLocaleString()} movies found</p>
            </header>

            {/* Sort Controls */}
            <div className="genre-controls">
                <span className="controls-label">Sort by:</span>
                <div className="sort-buttons">
                    <button
                        className={`sort-btn ${sortBy === 'rating' ? 'active' : ''}`}
                        onClick={() => handleSortChange('rating')}
                    >
                        Rating {sortBy === 'rating' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </button>
                    <button
                        className={`sort-btn ${sortBy === 'movie_name' ? 'active' : ''}`}
                        onClick={() => handleSortChange('movie_name')}
                    >
                        Name {sortBy === 'movie_name' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </button>
                    <button
                        className={`sort-btn ${sortBy === 'runtime' ? 'active' : ''}`}
                        onClick={() => handleSortChange('runtime')}
                    >
                        Runtime {sortBy === 'runtime' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </button>
                    <button
                        className={`sort-btn ${sortBy === 'metascore' ? 'active' : ''}`}
                        onClick={() => handleSortChange('metascore')}
                    >
                        Metascore {sortBy === 'metascore' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </button>
                </div>
            </div>

            {/* Movies Grid */}
            {loading ? (
                <div className="genre-loading">
                    <div className="loading-spinner"></div>
                    <p>Loading movies...</p>
                </div>
            ) : error ? (
                <div className="genre-error">
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>Try Again</button>
                </div>
            ) : (
                <>
                    <div className="movies-grid">
                        {movies.map((movie) => (
                            <MovieCard key={movie.id} movie={movie} />
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="pagination">
                            <button
                                className="pagination-btn"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                ← Previous
                            </button>
                            <span className="pagination-info">
                                Page {page + 1} of {totalPages}
                            </span>
                            <button
                                className="pagination-btn"
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
