import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getMovieById, getMovieTrailers, getSimilarMovies } from '../api/movies';
import MovieCarousel from '../components/MovieCarousel';
import AddToListButton from '../components/AddToListButton';
import { useListsContext } from '../context/useListsContext';
import './MovieDetailsPage.css';
import LoadingQuips from '../components/LoadingQuips';

export default function MovieDetailsPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const listsApi = useListsContext();
    const [movie, setMovie] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [similar, setSimilar] = useState([]);
    const [similarLoading, setSimilarLoading] = useState(false);
    const [trailers, setTrailers] = useState([]);
    const [activeTrailer, setActiveTrailer] = useState(null);

    useEffect(() => {
        const fetchMovie = async () => {
            try {
                setLoading(true);
                const data = await getMovieById(id);
                setMovie(data);
                // Trailers are a nice-to-have; never block the page on them.
                getMovieTrailers(id)
                    .then((t) => setTrailers(t))
                    .catch(() => setTrailers([]));
                // "More like this" — non-blocking; hide quietly if none.
                setSimilarLoading(true);
                getSimilarMovies(id, 12)
                    .then((s) => setSimilar(s ?? []))
                    .catch(() => setSimilar([]))
                    .finally(() => setSimilarLoading(false));
            } catch (err) {
                console.error('Failed to fetch movie:', err);
                setError('Movie not found');
            } finally {
                setLoading(false);
            }
        };

        fetchMovie();
    }, [id]);

    // Format runtime to hours and minutes
    const formatRuntime = (minutes) => {
        if (!minutes) return 'N/A';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    // Get genres as array
    const getGenres = (genreString) => {
        if (!genreString) return [];
        return genreString.split(',').map(g => g.trim());
    };

    if (loading) {
        return (
            <div className="movie-details-page">
                <div className="movie-details-loading">
                    <div className="loading-spinner"></div>
                    <LoadingQuips />
                </div>
            </div>
        );
    }

    if (error || !movie) {
        return (
            <div className="movie-details-page">
                <div className="movie-details-error">
                    <h2>Movie Not Found</h2>
                    <p>{error || 'The requested movie could not be found.'}</p>
                    <button onClick={() => navigate('/')}>Back to Home</button>
                </div>
            </div>
        );
    }

    return (
        <div className="movie-details-page">
            {/* Back Button */}
            <button className="back-button" onClick={() => navigate(-1)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
                Back
            </button>

            {/* Hero Section */}
            <section className="movie-hero">
                <div className="movie-hero-backdrop">
                    <img
                        src={movie.poster_url || 'https://via.placeholder.com/1200x600?text=No+Image'}
                        alt=""
                        className="backdrop-image"
                    />
                    <div className="backdrop-overlay"></div>
                </div>

                <div className="movie-hero-content">
                    {/* Poster */}
                    <div className="movie-poster-container">
                        <img
                            src={movie.poster_url || 'https://via.placeholder.com/300x450?text=No+Poster'}
                            alt={`${movie.movie_name} poster`}
                            className="movie-poster"
                            onError={(e) => {
                                e.target.src = 'https://via.placeholder.com/300x450?text=No+Poster';
                            }}
                        />
                    </div>

                    {/* Info */}
                    <div className="movie-info">
                        <h1 className="movie-title">
                            {movie.movie_name}
                            {movie.release_year && <span className="movie-year-inline"> ({movie.release_year})</span>}
                        </h1>

                        {/* Meta Info */}
                        <div className="movie-meta">
                            {movie.rating && (
                                <div className="meta-item rating">
                                    <span className="rating-star">★</span>
                                    <span className="rating-value">{movie.rating.toFixed(1)}</span>
                                    <span className="rating-max">/10</span>
                                </div>
                            )}
                            {movie.runtime && (
                                <div className="meta-item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M12 6v6l4 2" />
                                    </svg>
                                    {formatRuntime(movie.runtime)}
                                </div>
                            )}
                            {movie.metascore && movie.metascore > 0 && (
                                <div className={`meta-item metascore ${movie.metascore >= 60 ? 'good' : movie.metascore >= 40 ? 'mixed' : 'bad'}`}>
                                    {movie.metascore}
                                </div>
                            )}
                        </div>

                        {/* Actions: save to list + trailer */}
                        {(listsApi || trailers.length > 0) && movie && (
                            <div className="movie-actions">
                                {listsApi && (
                                    <AddToListButton
                                        movie={movie}
                                        lists={listsApi.lists}
                                        toggleList={listsApi.toggleMovieInList}
                                        createAndSave={listsApi.createListAndSave}
                                        isSaved={listsApi.isSaved}
                                        variant="plain"
                                    />
                                )}
                                {trailers.length > 0 && (
                                    <button
                                        className="trailer-button"
                                        onClick={() => setActiveTrailer(trailers[0])}
                                    >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                        Watch trailer
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Genres */}
                        {movie.genre && (
                            <div className="movie-genres">
                                {getGenres(movie.genre).map((genre, index) => (
                                    <span key={index} className="genre-tag">{genre}</span>
                                ))}
                            </div>
                        )}

                        {/* Plot */}
                        {movie.plot && (
                            <div className="movie-plot">
                                <h3>Plot</h3>
                                <p>{movie.plot}</p>
                            </div>
                        )}

                        {/* Cast & Crew */}
                        <div className="movie-credits">
                            {movie.directors && (
                                <div className="credit-section">
                                    <h4>Directors</h4>
                                    <p>{movie.directors}</p>
                                </div>
                            )}
                            {movie.stars && (
                                <div className="credit-section">
                                    <h4>Stars</h4>
                                    <p>{movie.stars}</p>
                                </div>
                            )}
                        </div>

                        {/* Additional Info */}
                        <div className="movie-extra">
                            {movie.votes && (
                                <div className="extra-item">
                                    <span className="extra-label">Votes:</span>
                                    <span className="extra-value">{movie.votes}</span>
                                </div>
                            )}
                            {movie.gross && (
                                <div className="extra-item">
                                    <span className="extra-label">Box Office:</span>
                                    <span className="extra-value">${movie.gross}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* More Like This */}
            {!loading && !error && !similarLoading && similar.length > 0 && (
                <section className="similar-section">
                    <h2 className="similar-title">More Like This</h2>
                    <MovieCarousel movies={similar} />
                </section>
            )}

            {/* Trailer lightbox */}
            {activeTrailer && (
                <div className="trailer-modal" onClick={() => setActiveTrailer(null)} role="dialog" aria-modal="true" aria-label="Trailer">
                    <div className="trailer-modal-box" onClick={(e) => e.stopPropagation()}>
                        <button className="trailer-close" onClick={() => setActiveTrailer(null)} aria-label="Close">
                            ✕
                        </button>
                        <iframe
                            className="trailer-frame"
                            src={`https://www.youtube.com/embed/${activeTrailer.key}?autoplay=1`}
                            title={activeTrailer.name || 'Trailer'}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
