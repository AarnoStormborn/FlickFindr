import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import { searchMovies } from '../api/movies';
import { shelfById, eraParams } from '../data/shelves';
import './GenrePage.css';

const MOVIES_PER_PAGE = 20;

export default function EraPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [movies, setMovies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [sortBy, setSortBy] = useState('rating');
    const [sortOrder, setSortOrder] = useState('desc');

    const shelf = shelfById(id);
    const filters = eraParams(id);

    useEffect(() => {
        if (!filters) return;
        const fetchMovies = async () => {
            try {
                setLoading(true);
                const response = await searchMovies({
                    ...filters,
                    sortBy,
                    sortOrder,
                    skip: page * MOVIES_PER_PAGE,
                    limit: MOVIES_PER_PAGE,
                });
                setMovies(response.results);
                setTotal(response.total);
            } catch (err) {
                console.error('Failed to fetch era movies:', err);
                setError('Failed to load movies');
            } finally {
                setLoading(false);
            }
        };
        fetchMovies();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- filters derive deterministically from id
    }, [id, page, sortBy, sortOrder]);

    const handleSortChange = (newSortBy) => {
        if (newSortBy === sortBy) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(newSortBy);
            setSortOrder('desc');
        }
        setPage(0);
    };

    if (!shelf || !filters) {
        return (
            <div className="genre-page">
                <div className="genre-error">
                    <p>Unknown era.</p>
                    <button onClick={() => navigate('/')}>Back to Home</button>
                </div>
            </div>
        );
    }

    const totalPages = Math.ceil(total / MOVIES_PER_PAGE);
    const subtitle = shelf.id === 'latest' ? 'Fresh from the last two years' : shelf.caption;

    return (
        <div className="genre-page">
            <button className="back-button" onClick={() => navigate('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            <header className="genre-header">
                <h1 className="genre-title">{shelf.displayName}</h1>
                <p className="genre-count">{subtitle} · {total.toLocaleString()} movies</p>
            </header>

            <div className="genre-controls">
                <span className="controls-label">Sort by:</span>
                <div className="sort-buttons">
                    <button
                        className={`sort-btn ${sortBy === 'rating' ? 'active' : ''}`}
                        onClick={() => handleSortChange('rating')}
                    >
                        Rating {sortBy === 'rating' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </button>
                    {shelf.id === 'latest' && (
                        <button
                            className={`sort-btn ${sortBy === 'release_year' ? 'active' : ''}`}
                            onClick={() => handleSortChange('release_year')}
                        >
                            Year {sortBy === 'release_year' && (sortOrder === 'desc' ? '↓' : '↑')}
                        </button>
                    )}
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
                </div>
            </div>

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

                    {totalPages > 1 && (
                        <div className="pagination">
                            <button
                                className="pagination-btn"
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                ← Previous
                            </button>
                            <span className="pagination-info">
                                Page {page + 1} of {totalPages}
                            </span>
                            <button
                                className="pagination-btn"
                                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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