import { useNavigate } from 'react-router-dom';
import './MovieCard.css';

export default function MovieCard({ movie }) {
    const navigate = useNavigate();
    const {
        id,
        movie_name,
        rating,
        genre,
        poster_url,
        runtime,
    } = movie;

    // Fallback poster if URL is missing or broken
    const posterSrc = poster_url || 'https://via.placeholder.com/300x450?text=No+Poster';

    // Format runtime to hours and minutes
    const formatRuntime = (minutes) => {
        if (!minutes) return null;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    const handleClick = () => {
        navigate(`/movie/${id}`);
    };

    return (
        <article className="movie-card" data-movie-id={id} onClick={handleClick}>
            <div className="movie-card-poster">
                <img
                    src={posterSrc}
                    alt={`${movie_name} poster`}
                    className="movie-card-image"
                    loading="lazy"
                    onError={(e) => {
                        e.target.src = 'https://via.placeholder.com/300x450?text=No+Poster';
                    }}
                />

                {/* Rating Badge */}
                {rating && (
                    <div className="movie-card-rating">
                        <span className="rating-star">★</span>
                        <span className="rating-value">{rating.toFixed(1)}</span>
                    </div>
                )}

                {/* Hover Overlay */}
                <div className="movie-card-overlay">
                    <div className="overlay-content">
                        <h3 className="overlay-title">{movie_name}</h3>
                        <div className="overlay-meta">
                            {genre && <span className="overlay-genre">{genre.split(',')[0]}</span>}
                            {runtime && <span className="overlay-runtime">{formatRuntime(runtime)}</span>}
                        </div>
                        <button className="overlay-button">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            View Details
                        </button>
                    </div>
                </div>
            </div>
        </article>
    );
}
