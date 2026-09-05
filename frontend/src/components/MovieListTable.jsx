import { useNavigate } from 'react-router-dom';
import './MovieListTable.css';

const FALLBACK_POSTER = 'https://via.placeholder.com/100x150?text=No+Poster';

function formatRuntime(minutes) {
    if (!minutes) return null;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function primaryGenre(genre) {
    if (!genre) return null;
    return genre.split(',')[0].trim();
}

/**
 * Compact table of movies: poster thumb + name + key facts.
 * Each row navigates to the movie detail page.
 */
export default function MovieListTable({ movies, emptyText = 'No movies found' }) {
    const navigate = useNavigate();

    if (!movies || movies.length === 0) {
        return (
            <div className="movie-list-empty">
                <p>{emptyText}</p>
            </div>
        );
    }

    return (
        <div className="movie-list-table" role="table" aria-label="Movies">
            <div className="movie-list-head" role="row">
                <span className="col-poster" />
                <span className="col-title">Title</span>
                <span className="col-year">Year</span>
                <span className="col-rating">Rating</span>
                <span className="col-runtime">Runtime</span>
                <span className="col-genre">Genre</span>
                <span className="col-director">Directors</span>
            </div>
            {movies.map((movie) => {
                const runtime = formatRuntime(movie.runtime);
                const genre = primaryGenre(movie.genre);
                return (
                    <div
                        key={movie.id}
                        className="movie-list-row"
                        role="row"
                        tabIndex={0}
                        onClick={() => navigate(`/movie/${movie.id}`)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                navigate(`/movie/${movie.id}`);
                            }
                        }}
                    >
                        <span className="col-poster">
                            <img
                                className="movie-list-thumb"
                                src={movie.poster_url || FALLBACK_POSTER}
                                alt=""
                                loading="lazy"
                                onError={(e) => {
                                    e.target.src = FALLBACK_POSTER;
                                }}
                            />
                        </span>
                        <span className="col-title movie-list-title">{movie.movie_name}</span>
                        <span className="col-year">{movie.release_year ?? '—'}</span>
                        <span className="col-rating">
                            {movie.rating ? (
                                <>
                                    <span className="rating-star">★</span> {movie.rating.toFixed(1)}
                                </>
                            ) : (
                                '—'
                            )}
                        </span>
                        <span className="col-runtime">{runtime ?? '—'}</span>
                        <span className="col-genre">
                            {genre ? <span className="movie-list-genre">{genre}</span> : '—'}
                        </span>
                        <span className="col-director movie-list-directors">{movie.directors || '—'}</span>
                    </div>
                );
            })}
        </div>
    );
}