import MovieCarousel from './MovieCarousel';
import './CategoryRow.css';

export default function CategoryRow({ title, movies, isLoading, onSeeMore }) {
    return (
        <section className="category-row fade-in">
            <div className="category-header">
                <h2 className="category-title">{title}</h2>
                {onSeeMore && (
                    <button className="category-see-more" onClick={onSeeMore}>
                        See more
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m9 18 6-6-6-6" />
                        </svg>
                    </button>
                )}
            </div>
            <MovieCarousel movies={movies} isLoading={isLoading} />
        </section>
    );
}
