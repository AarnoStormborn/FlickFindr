import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import CategoryRow from '../components/CategoryRow';
import ViewToggle from '../components/ViewToggle';
import MovieListTable from '../components/MovieListTable';
import { getMoviesByGenre, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import './MoviesPage.css';

// Categories to display - curated list for best experience
const FEATURED_GENRES = [
    { name: 'Drama', displayName: 'Top Drama' },
    { name: 'Action', displayName: 'Action & Adventure' },
    { name: 'Comedy', displayName: 'Comedy' },
    { name: 'Crime', displayName: 'Crime & Thriller' },
    { name: 'Romance', displayName: 'Romance' },
    { name: 'Sci-Fi', displayName: 'Sci-Fi & Fantasy' },
    { name: 'Horror', displayName: 'Horror' },
    { name: 'Animation', displayName: 'Animation & Family' },
];

export default function MoviesPage() {
    const navigate = useNavigate();
    const [categoryData, setCategoryData] = useState({});
    const [loading, setLoading] = useState({});
    const [error, setError] = useState(null);
    const [view, setView] = useViewMode();
    const [topMovies, setTopMovies] = useState([]);
    const [topLoading, setTopLoading] = useState(false);

    // Fetch movies for each genre on mount
    useEffect(() => {
        const fetchAllCategories = async () => {
            // Initialize loading states
            const loadingState = {};
            FEATURED_GENRES.forEach(g => loadingState[g.name] = true);
            setLoading(loadingState);

            // Fetch each genre in parallel
            const fetchPromises = FEATURED_GENRES.map(async (genre) => {
                try {
                    const response = await getMoviesByGenre(genre.name, 15);
                    return { genre: genre.name, data: response.results };
                } catch (err) {
                    console.error(`Failed to fetch ${genre.name}:`, err);
                    return { genre: genre.name, data: [] };
                }
            });

            try {
                const results = await Promise.all(fetchPromises);

                const newCategoryData = {};
                const newLoading = {};

                results.forEach(({ genre, data }) => {
                    newCategoryData[genre] = data;
                    newLoading[genre] = false;
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

    const handleSeeMore = (genre) => {
        navigate(`/genre/${genre}`);
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
                    {FEATURED_GENRES.map((genre) => (
                        <CategoryRow
                            key={genre.name}
                            title={genre.displayName}
                            movies={categoryData[genre.name] || []}
                            isLoading={loading[genre.name]}
                            onSeeMore={() => handleSeeMore(genre.name)}
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
