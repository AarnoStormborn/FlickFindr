import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import CategoryRow from '../components/CategoryRow';
import ViewToggle from '../components/ViewToggle';
import MovieListTable from '../components/MovieListTable';
import { getMoviesByGenre, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import './MoviesPage.css';

// Categories to display - curated list for best experience.
// `genres` are the real DB genre names (TMDB naming); `seeMoreGenre` is the
// genre used for the "See more" link.
const FEATURED_GENRES = [
    { id: 'drama', displayName: 'Top Drama', genres: ['Drama'], seeMoreGenre: 'Drama' },
    { id: 'action', displayName: 'Action & Adventure', genres: ['Action', 'Adventure'], seeMoreGenre: 'Action' },
    { id: 'comedy', displayName: 'Comedy', genres: ['Comedy'], seeMoreGenre: 'Comedy' },
    { id: 'crime', displayName: 'Crime & Thriller', genres: ['Crime', 'Thriller'], seeMoreGenre: 'Crime' },
    { id: 'romance', displayName: 'Romance', genres: ['Romance'], seeMoreGenre: 'Romance' },
    { id: 'scifi', displayName: 'Sci-Fi & Fantasy', genres: ['Science Fiction', 'Fantasy'], seeMoreGenre: 'Science Fiction' },
    { id: 'horror', displayName: 'Horror', genres: ['Horror'], seeMoreGenre: 'Horror' },
    { id: 'animation', displayName: 'Animation & Family', genres: ['Animation', 'Family'], seeMoreGenre: 'Animation' },
];

export default function MoviesPage() {
    const navigate = useNavigate();
    const [categoryData, setCategoryData] = useState({});
    const [loading, setLoading] = useState({});
    const [error, setError] = useState(null);
    const [view, setView] = useViewMode();
    const [topMovies, setTopMovies] = useState([]);
    const [topLoading, setTopLoading] = useState(false);

    // Fetch movies for each featured category on mount.
    useEffect(() => {
        const fetchAllCategories = async () => {
            const loadingState = {};
            FEATURED_GENRES.forEach((g) => (loadingState[g.id] = true));
            setLoading(loadingState);

            // Each category may span multiple genres — fetch in parallel,
            // merge with dedupe, sort by rating desc.
            const fetchPromises = FEATURED_GENRES.map(async (cat) => {
                try {
                    const perGenre = await Promise.all(
                        cat.genres.map((g) => getMoviesByGenre(g, 15)),
                    );
                    const seen = new Set();
                    const merged = [];
                    perGenre
                        .flatMap((res) => res.results ?? [])
                        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                        .forEach((m) => {
                            if (seen.has(m.id)) return;
                            seen.add(m.id);
                            merged.push(m);
                        });
                    return { id: cat.id, data: merged.slice(0, 15) };
                } catch (err) {
                    console.error(`Failed to fetch ${cat.displayName}:`, err);
                    return { id: cat.id, data: [] };
                }
            });

            try {
                const results = await Promise.all(fetchPromises);
                const newCategoryData = {};
                const newLoading = {};
                results.forEach(({ id, data }) => {
                    newCategoryData[id] = data;
                    newLoading[id] = false;
                });
                setCategoryData(newCategoryData);
                setLoading(newLoading);
            } catch (err) {
                console.error('Failed to fetch categories:', err);
                setError('Failed to load movies. Please try again later.');
            }
        };

        fetchAllCategories();
    }, []);

    const handleSeeMore = (category) => {
        navigate(`/genre/${category.seeMoreGenre}`);
    };

    // Load a broad, top-rated set the first time list view is opened.
    const handleViewChange = (nextView) => {
        setView(nextView);
        if (nextView === 'list' && topMovies.length === 0 && !topLoading) {
            setTopLoading(true);
            searchMovies({ limit: 50, sortBy: 'rating', sortOrder: 'desc' })
                .then((res) => setTopMovies(res.results ?? []))
                .catch((err) => console.error('Failed to load top movies:', err))
                .finally(() => setTopLoading(false));
        }
    };

    if (error) {
        return (
            <div className="movies-page">
                <div className="movies-error">
                    <h2>Oops!</h2>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>Try Again</button>
                </div>
            </div>
        );
    }

    return (
        <main className="movies-page">
            {/* Hero Section */}
            <section className="movies-hero">
                <div className="hero-content">
                    <h1 className="hero-title">
                        Discover Your Next
                        <span className="hero-highlight"> Favorite Film</span>
                    </h1>
                    <p className="hero-subtitle">
                        Explore our collection of nearly 30,000 movies across all genres
                    </p>
                    <div className="hero-view-toggle">
                        <ViewToggle view={view} onChange={handleViewChange} />
                    </div>
                </div>
                <div className="hero-gradient"></div>
            </section>

            {/* Category Rows */}
            {view === 'grid' ? (
                <div className="movies-categories">
                    {FEATURED_GENRES.map((cat) => (
                        <CategoryRow
                            key={cat.id}
                            title={cat.displayName}
                            movies={categoryData[cat.id] || []}
                            isLoading={loading[cat.id]}
                            onSeeMore={() => handleSeeMore(cat)}
                        />
                    ))}
                </div>
            ) : (
                <div className="movies-categories">
                    <section className="category-row fade-in">
                        <div className="category-header">
                            <h2 className="category-title">Top Rated</h2>
                        </div>
                        {topLoading ? (
                            <div className="genre-loading">
                                <div className="loading-spinner"></div>
                                <p>Loading movies...</p>
                            </div>
                        ) : (
                            <MovieListTable movies={topMovies} emptyText="No movies found" />
                        )}
                    </section>
                </div>
            )}

            {/* Footer spacing */}
            <div className="movies-footer-space"></div>
        </main>
    );
}
