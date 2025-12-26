import { useRef, useState, useEffect } from 'react';
import MovieCard from './MovieCard';
import './MovieCarousel.css';

export default function MovieCarousel({ movies, isLoading }) {
    const scrollRef = useRef(null);
    const [showLeftArrow, setShowLeftArrow] = useState(false);
    const [showRightArrow, setShowRightArrow] = useState(true);

    const checkScrollButtons = () => {
        if (!scrollRef.current) return;

        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setShowLeftArrow(scrollLeft > 10);
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    };

    useEffect(() => {
        checkScrollButtons();
        const scrollContainer = scrollRef.current;
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', checkScrollButtons);
            return () => scrollContainer.removeEventListener('scroll', checkScrollButtons);
        }
    }, [movies]);

    const scroll = (direction) => {
        if (!scrollRef.current) return;

        const scrollAmount = scrollRef.current.clientWidth * 0.8;
        scrollRef.current.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        });
    };

    // Skeleton loading cards
    if (isLoading) {
        return (
            <div className="movie-carousel">
                <div className="carousel-track">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="movie-card-skeleton">
                            <div className="skeleton skeleton-poster"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!movies || movies.length === 0) {
        return (
            <div className="movie-carousel movie-carousel-empty">
                <p>No movies found</p>
            </div>
        );
    }

    return (
        <div className="movie-carousel">
            {/* Left Arrow */}
            <button
                className={`carousel-arrow carousel-arrow-left ${showLeftArrow ? 'visible' : ''}`}
                onClick={() => scroll('left')}
                aria-label="Scroll left"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m15 18-6-6 6-6" />
                </svg>
            </button>

            {/* Carousel Track */}
            <div className="carousel-track" ref={scrollRef}>
                {movies.map((movie) => (
                    <MovieCard key={movie.id} movie={movie} />
                ))}
            </div>

            {/* Right Arrow */}
            <button
                className={`carousel-arrow carousel-arrow-right ${showRightArrow ? 'visible' : ''}`}
                onClick={() => scroll('right')}
                aria-label="Scroll right"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 18 6-6-6-6" />
                </svg>
            </button>

            {/* Gradient Edges */}
            <div className={`carousel-gradient carousel-gradient-left ${showLeftArrow ? 'visible' : ''}`}></div>
            <div className={`carousel-gradient carousel-gradient-right ${showRightArrow ? 'visible' : ''}`}></div>
        </div>
    );
}
