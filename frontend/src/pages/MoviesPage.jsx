import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import CategoryRow from '../components/CategoryRow';
import ViewToggle from '../components/ViewToggle';
import MovieListTable from '../components/MovieListTable';
import { getMoviesByGenre, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import './MoviesPage.css';

const CURRENT_YEAR = new Date().getFullYear();

/** Shelves use a vote floor so a handful of votes can't game the rating sort. */
const BEST_OF_MIN_VOTES = 1000;
const LATEST_MIN_VOTES = 300;

/** Curated year-based shelves shown first. */
const YEAR_SHELVES = [
    {
        id: 'latest',
        displayName: 'Latest Releases',
        caption: 'Fresh from the last two years',
        load: () => searchMovies({ minYear: CURRENT_YEAR - 2, maxYear: CURRENT_YEAR, limit: 15, minVotes: LATEST_MIN_VOTES, sortBy: 'release_year', sortOrder: 'desc' }),
    },
    {
        id: 'retro',
        displayName: 'Going Retro',
        caption: 'Totally rad picks from the 80s',
        load: () => searchMovies({ minYear: 1980, maxYear: 1989, limit: 15, minVotes: BEST_OF_MIN_VOTES, sortBy: 'rating', sortOrder: 'desc' }),
    },
    {
        id: 'millennium',
        displayName: 'The Millennium Classics',
        caption: 'The best of 2000–2009',
        load: () => searchMovies({ minYear: 2000, maxYear: 2009, limit: 15, minVotes: BEST_OF_MIN_VOTES, sortBy: 'rating', sortOrder: 'desc' }),
    },
];

/** Curated genre rows shown after the year shelves. */
const GENRE_ROWS = [
    { id: 'drama', displayName: 'Top Drama', genres: ['Drama'], seeMoreGenre: 'Drama' },
    { id: 'action', displayName: 'Action & Adventure', genres: ['Action', 'Adventure'], seeMoreGenre: 'Action' },
    { id: 'comedy', displayName: 'Comedy', genres: ['Comedy'], seeMoreGenre: 'Comedy' },
    { id: 'scifi', displayName: 'Sci-Fi & Fantasy', genres: ['Science Fiction', 'Fantasy'], seeMoreGenre: 'Science Fiction' },
];

const ALL_ROWS = [...YEAR_SHELVES, ...GENRE_ROWS];

/** Merge multiple result sets, dedupe by id, keep top N by rating desc. */
function mergeTop(perFetch, top = 15) {
    const seen = new Set();
    const merged = [];
    perFetch
        .flatMap((res) => res.results ?? [])
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .forEach((m) => {
            if (seen.has(m.id)) return;
            seen.add(m.id);
            merged.push(m);
        });
    return merged.slice(0, top);
}

export default function MoviesPage() {
    const navigate = useNavigate();
    const [rowData, setRowData] = useState({});
    const [loading, setLoading] = useState({});
    const [error, setError] = useState(null);
    const [view, setView] = useViewMode();
    const [topMovies, setTopMovies] = useState([]);
    const [topLoading, setTopLoading] = useState(false);

    // Fetch each shelf/row on mount.
    useEffect(() => {
        const fetchAll = async () => {
            const loadingState = {};
            ALL_ROWS.forEach((r) => (loadingState[r.id] = true));
            setLoading(loadingState);

            const promises = ALL_ROWS.map(async (row) => {
                try {
                    let movies;
                    if (row.load) {
                        const res = await row.load();
                        movies = res.results ?? [];
                    } else {
                        const perGenre = await Promise.all(row.genres.map((g) => getMoviesByGenre(g, 15, BEST_OF_MIN_VOTES)));
                        movies = mergeTop(perGenre, 15);
                    }
                    return { id: row.id, data: movies };
                } catch (err) {
                    console.error(`Failed to fetch ${row.displayName}:`, err);
                    return { id: row.id, data: [] };
                }
            });

            try {
                const results = await Promise.all(promises);
                const data = {};
                const done = {};
                results.forEach(({ id, data: movies }) => {
                    data[id] = movies;
                    done[id] = false;
                });
                setRowData(data);
                setLoading(done);
            } catch (err) {
                console.error('Failed to fetch rows:', err);
                setError('Failed to load movies. Please try again later.');
            }
        };
        fetchAll();
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

    const renderShelf = (row, isGenre) => (
        <CategoryRow
            key={row.id}
            title={row.displayName}
            caption={row.caption}
            movies={rowData[row.id] || []}
            isLoading={loading[row.id]}
            onSeeMore={isGenre ? () => handleSeeMore(row.seeMoreGenre) : undefined}
        />
    );

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

            {/* Shelves */}
            {view === 'grid' ? (
                <div className="movies-categories">
                    {YEAR_SHELVES.map((row) => renderShelf(row, false))}
                    <div className="genre-row-divider" />
                    {GENRE_ROWS.map((row) => renderShelf(row, true))}
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