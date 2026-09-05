import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import MovieListTable from '../components/MovieListTable';
import ViewToggle from '../components/ViewToggle';
import MetadataForm from '../components/MetadataForm';
import { hybridSearch, semanticSearch, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import './SearchPage.css';

const MODES = [
    {
        id: 'hybrid',
        label: 'Hybrid',
        title: 'Natural language + filters',
        description: 'Describe what you want; combine with filters. Best for everyday searches.',
    },
    {
        id: 'semantic',
        label: 'Describe the plot',
        title: 'Search by what it’s about',
        description: 'Type a story, mood, or scene — “a prison escape about friendship”.',
    },
    {
        id: 'structural',
        label: 'Filter by details',
        title: 'Search with metadata',
        description: 'Narrow by genre, actor, director, release year, rating — no sentence needed.',
    },
];

function modeTitle(id) {
    return MODES.find((m) => m.id === id)?.title ?? '';
}

/** Read metadata filters out of URL search params (back-nav friendly). */
function filtersFromParams(searchParams) {
    const get = (k) => searchParams.get(k) ?? undefined;
    return {
        query: get('title'),
        genre: get('genre'),
        stars: get('actor'),
        directors: get('director'),
        minYear: get('min_year') ? Number(get('min_year')) : undefined,
        maxYear: get('max_year') ? Number(get('max_year')) : undefined,
        minRating: get('min_rating') ? Number(get('min_rating')) : undefined,
        sortBy: get('sort_by') || 'rating',
        sortOrder: get('sort_order') || 'desc',
    };
}

export default function SearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const queryFromUrl = searchParams.get('q') ?? '';
    const modeFromUrl = searchParams.get('mode') ?? 'hybrid';
    const isStructural = modeFromUrl === 'structural';
    const urlFilters = isStructural ? filtersFromParams(searchParams) : null;

    const [input, setInput] = useState(queryFromUrl);
    const [mode, setMode] = useState(MODES.some((m) => m.id === modeFromUrl) ? modeFromUrl : 'hybrid');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [meta, setMeta] = useState(null); // { message, exact_matches, total }
    const [searched, setSearched] = useState('');
    const [structuralFilters, setStructuralFilters] = useState(urlFilters);
    const [view, setView] = useViewMode();

    const runTextSearch = useCallback(async (query, searchMode) => {
        if (!query.trim()) {
            setResults([]);
            setMeta(null);
            setSearched('');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            let data;
            let message = null;
            if (searchMode === 'semantic') {
                data = await semanticSearch(query.trim(), 20);
                message = data.message;
            } else if (searchMode === 'structural') {
                data = await searchMovies({ query: query.trim(), limit: 20, sortBy: 'rating', sortOrder: 'desc' });
            } else {
                data = await hybridSearch({ query: query.trim(), limit: 20 });
                message = data.message;
            }
            setResults(data.results ?? []);
            setMeta({
                message,
                exact_matches: data.exact_matches ?? null,
                total: data.total ?? data.results?.length ?? 0,
            });
            setSearched(query.trim());
        } catch (err) {
            console.error('Search failed:', err);
            setError(err.message || 'Search failed. Is the backend running?');
            setResults([]);
            setMeta(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const runStructuralSearch = useCallback(async (filters) => {
        setLoading(true);
        setError(null);
        try {
            const params = {
                limit: 30,
                sortBy: filters.sortBy,
                sortOrder: filters.sortOrder,
            };
            if (filters.query) params.query = filters.query;
            if (filters.genre) params.genre = filters.genre;
            if (filters.stars) params.stars = filters.stars;
            if (filters.directors) params.directors = filters.directors;
            if (filters.minYear) params.minYear = filters.minYear;
            if (filters.maxYear) params.maxYear = filters.maxYear;
            if (filters.minRating) params.minRating = filters.minRating;
            const data = await searchMovies(params);
            setResults(data.results ?? []);
            setMeta({
                message: null,
                exact_matches: null,
                total: data.total ?? data.results?.length ?? 0,
            });
            const label = [
                filters.query && `title "${filters.query}"`,
                filters.genre && `genre ${filters.genre}`,
                filters.stars && `actor ${filters.stars}`,
                filters.directors && `director ${filters.directors}`,
                filters.minYear && `since ${filters.minYear}`,
                filters.maxYear && `until ${filters.maxYear}`,
                filters.minRating && `${filters.minRating}+ rating`,
            ].filter(Boolean).join(', ');
            setSearched(label || 'all movies');
        } catch (err) {
            console.error('Search failed:', err);
            setError(err.message || 'Search failed. Is the backend running?');
            setResults([]);
            setMeta(null);
        } finally {
            setLoading(false);
        }
    }, []);

    // Sync URL state into the page + trigger search on navigation / back.
    useEffect(() => {
        setInput(queryFromUrl);
        setMode(MODES.some((m) => m.id === modeFromUrl) ? modeFromUrl : 'hybrid');
        if (modeFromUrl === 'structural') {
            const filters = filtersFromParams(searchParams);
            setStructuralFilters(filters);
            const hasAny = Object.values(filters).some((v) => v !== undefined && v !== 'rating' && v !== 'desc');
            if (hasAny) runStructuralSearch(filters);
            else {
                setResults([]);
                setMeta(null);
                setSearched('');
            }
        } else if (queryFromUrl) {
            runTextSearch(queryFromUrl, modeFromUrl);
        }
    }, [queryFromUrl, modeFromUrl, runTextSearch, runStructuralSearch, searchParams]);

    const submitText = (e) => {
        e?.preventDefault?.();
        setSearchParams({ q: input.trim(), mode });
        runTextSearch(input, mode);
    };

    const submitStructural = (filters) => {
        setStructuralFilters(filters);
        const sp = new URLSearchParams({ mode: 'structural' });
        if (filters.query) sp.set('title', filters.query);
        if (filters.genre) sp.set('genre', filters.genre);
        if (filters.stars) sp.set('actor', filters.stars);
        if (filters.directors) sp.set('director', filters.directors);
        if (filters.minYear) sp.set('min_year', filters.minYear);
        if (filters.maxYear) sp.set('max_year', filters.maxYear);
        if (filters.minRating) sp.set('min_rating', filters.minRating);
        if (filters.sortBy !== 'rating') sp.set('sort_by', filters.sortBy);
        if (filters.sortOrder !== 'desc') sp.set('sort_order', filters.sortOrder);
        setSearchParams(sp);
        runStructuralSearch(filters);
    };

    const switchMode = (id) => {
        setMode(id);
        setResults([]);
        setMeta(null);
        setSearched('');
        setError(null);
        if (id === 'structural') {
            setSearchParams({ mode: id });
        } else if (input.trim()) {
            setSearchParams({ q: input.trim(), mode: id });
            runTextSearch(input, id);
        } else {
            setSearchParams({ mode: id });
        }
    };

    const showSearchBar = mode === 'hybrid' || mode === 'semantic';

    return (
        <div className="search-page">
            <section className="search-hero">
                <h1 className="search-title">Find your next movie</h1>
                <p className="search-subtitle">
                    {showSearchBar
                        ? 'Say what you’re in the mood for — or switch to “Filter by details” to search on genre, actor, director, year, and more.'
                        : 'Set any combination of fields below — no sentence needed.'}
                </p>

                {showSearchBar ? (
                    <form className="search-bar" onSubmit={submitText} role="search">
                        <svg className="search-bar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                        <input
                            type="text"
                            className="search-bar-input"
                            placeholder="Try 'a dark superhero movie by Nolan'…"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            autoFocus
                        />
                        <button type="submit" className="search-bar-button">Search</button>
                    </form>
                ) : (
                    <MetadataForm
                        key={modeFromUrl + JSON.stringify(urlFilters || {})}
                        initial={urlFilters}
                        onSearch={submitStructural}
                    />
                )}

                <div className="search-modes">
                    {MODES.map((m) => (
                        <button
                            key={m.id}
                            className={`mode-chip ${mode === m.id ? 'active' : ''}`}
                            onClick={() => switchMode(m.id)}
                            title={m.description}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                <p className="mode-hint">{modeTitle(mode)}</p>
            </section>

            <section className="search-results">
                {loading && (
                    <div className="search-loading">
                        <div className="loading-spinner"></div>
                        <p>Searching movies…</p>
                    </div>
                )}

                {!loading && error && (
                    <div className="search-error">
                        <p>{error}</p>
                        <button className="search-retry" onClick={() => (mode === 'structural' ? runStructuralSearch(structuralFilters) : runTextSearch(input, mode))}>Try Again</button>
                    </div>
                )}

                {!loading && !error && searched && meta && (
                    <div className="search-head">
                        <h2 className="search-results-title">
                            Results for “{searched}”
                        </h2>
                        <div className="search-meta-row">
                            <div className="search-meta-text">
                                {meta.message && (
                                    <p className={`search-message ${meta.exact_matches === true ? 'exact' : meta.exact_matches === false ? 'similar' : ''}`}>
                                        {meta.message}
                                    </p>
                                )}
                                {typeof meta.total === 'number' && (
                                    <p className="search-message">{meta.total.toLocaleString()} matches</p>
                                )}
                            </div>
                            <ViewToggle view={view} onChange={setView} />
                        </div>
                    </div>
                )}

                {!loading && !error && searched && results.length === 0 && (
                    <div className="search-empty">
                        <p>No movies matched that search.</p>
                    </div>
                )}

                {!loading && !error && results.length > 0 && (view === 'grid' ? (
                    <div className="search-grid">
                        {results.map((movie) => (
                            <MovieCard key={movie.id} movie={movie} />
                        ))}
                    </div>
                ) : (
                    <MovieListTable movies={results} emptyText="No movies matched that search." />
                ))}

                {!loading && !error && !searched && mode !== 'structural' && (
                    <div className="search-empty">
                        <p>Enter a query above — try comparing modes to see the difference.</p>
                    </div>
                )}
                {!loading && !error && !searched && mode === 'structural' && (
                    <div className="search-empty">
                        <p>Set some fields above, then press Search movies.</p>
                    </div>
                )}
            </section>

            <a className="search-home-link" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                ← Back to Home
            </a>
        </div>
    );
}