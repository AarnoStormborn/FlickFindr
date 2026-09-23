import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CategoryRow from '../components/CategoryRow';
import ViewToggle from '../components/ViewToggle';
import MovieListTable from '../components/MovieListTable';
import BrowseGrid from '../components/BrowseGrid';
import { getMoviesByGenre, searchMovies, getLanguages } from '../api/movies';
import { YEAR_SHELVES, GENRE_ROWS, BEST_OF_MIN_VOTES, LATEST_MIN_VOTES } from '../data/shelves';
import { MOODS } from '../data/moods';
import { languageName, languageOptionLabel } from '../lib/languages';
import useViewMode from '../hooks/useViewMode';
import { mergeTop } from '../lib/mergeTop';
import './MoviesPage.css';
// BrowseGrid's markup is styled by the shared browse-page sheet.
import './GenrePage.css';
import LoadingQuips from '../components/LoadingQuips';

const CURRENT_YEAR = new Date().getFullYear();

/** Home rows: 15-result queries (full browse lives on the /era pages). */
const HOME_SHELVES = YEAR_SHELVES.map((s) => ({
    ...s,
    load: () => {
        if (s.id === 'latest') {
            return searchMovies({ minYear: CURRENT_YEAR - 2, maxYear: CURRENT_YEAR, limit: 15, minVotes: LATEST_MIN_VOTES, sortBy: 'release_year', sortOrder: 'desc' });
        }
        if (s.id === 'retro') {
            return searchMovies({ minYear: 1980, maxYear: 1989, limit: 15, minVotes: BEST_OF_MIN_VOTES, sortBy: 'rating', sortOrder: 'desc' });
        }
        return searchMovies({ minYear: 2000, maxYear: 2009, limit: 15, minVotes: BEST_OF_MIN_VOTES, sortBy: 'rating', sortOrder: 'desc' });
    },
}));

/** Mood rows: the same filters as their "See more" page, trimmed to 15. */
const MOOD_ROWS = MOODS.map((m) => ({
    ...m,
    load: () => searchMovies({ ...m.filters, limit: 15, sortBy: 'rating', sortOrder: 'desc' }),
}));

const ALL_ROWS = [...HOME_SHELVES, ...GENRE_ROWS, ...MOOD_ROWS];

export default function MoviesPage() {
    const navigate = useNavigate();
    const [rowData, setRowData] = useState({});
    const [loading, setLoading] = useState({});
    const [error, setError] = useState(null);
    const [view, setView] = useViewMode();
    const [topMovies, setTopMovies] = useState([]);
    const [topLoading, setTopLoading] = useState(false);

    // The home language choice lives in the URL so it is shareable and survives
    // a reload, matching how the search page carries its language filter.
    const [searchParams, setSearchParams] = useSearchParams();
    const language = searchParams.get('lang') || '';
    const [languages, setLanguages] = useState([]);

    useEffect(() => {
        getLanguages()
            .then((list) => setLanguages(Array.isArray(list) ? list : []))
            .catch((err) => console.error('Failed to load languages:', err));
    }, []);

    const setLanguage = (code) => {
        const next = new URLSearchParams(searchParams);
        if (code) next.set('lang', code);
        else next.delete('lang');
        setSearchParams(next, { replace: true });
    };

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

    const handleSeeMore = (row, kind) => {
        if (kind === 'genre') navigate(`/genre/${row.seeMoreGenre}`);
        else if (kind === 'mood') navigate(`/mood/${row.id}`);
        else navigate(`/era/${row.id}`);
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

    const renderShelf = (row, kind) => (
        <CategoryRow
            key={row.id}
            title={row.displayName}
            caption={row.caption}
            movies={rowData[row.id] || []}
            isLoading={loading[row.id]}
            onSeeMore={() => handleSeeMore(row, kind)}
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

            {/* Language: choosing one swaps the shelves for a browse of that
                language rather than filtering every row, because most of the 88
                languages are small enough that scoped rows would come back
                empty (Swedish is 143 films, not 15-per-row across 11 rows). */}
            <div className="movies-lang-bar">
                <label className="lang-label" htmlFor="home-language">
                    Language
                </label>
                <select
                    id="home-language"
                    className="lang-select"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                >
                    <option value="">All languages</option>
                    {languages.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                            {languageOptionLabel(entry)}
                        </option>
                    ))}
                </select>
                {language && (
                    <button className="lang-clear" onClick={() => setLanguage('')}>
                        Clear
                    </button>
                )}
            </div>

            {language ? (
                <BrowseGrid
                    filters={{ language }}
                    title={`Top in ${languageName(language)}`}
                    subtitle="Ranked by vote-weighted rating"
                    sortOptions={[
                        { value: 'rating', label: 'Rating' },
                        { value: 'movie_name', label: 'Name' },
                    ]}
                    emptyText={`No films recorded in ${languageName(language)}.`}
                />
            ) : view === 'grid' ? (
                <div className="movies-categories">
                    {HOME_SHELVES.map((row) => renderShelf(row, 'era'))}
                    <div className="genre-row-divider" />
                    {GENRE_ROWS.map((row) => renderShelf(row, 'genre'))}
                    <div className="genre-row-divider" />
                    {MOOD_ROWS.map((row) => renderShelf(row, 'mood'))}
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
                                <LoadingQuips />
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