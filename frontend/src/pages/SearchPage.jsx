import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import MovieListTable from '../components/MovieListTable';
import ViewToggle from '../components/ViewToggle';
import MetadataForm from '../components/MetadataForm';
import { hybridSearch, semanticSearch, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import useSearchHistory from '../hooks/useSearchHistory';
import './SearchPage.css';

const TEXT_MODES = ['hybrid', 'semantic'];
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

function isValidMode(m) {
    return MODES.some((x) => x.id === m);
}

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

/** Human-readable summary of structural filters. */
function filtersLabel(f) {
    return [
        f.query && `title "${f.query}"`,
        f.genre && `genre ${f.genre}`,
        f.stars && `actor ${f.stars}`,
        f.directors && `director ${f.directors}`,
        f.minYear && `since ${f.minYear}`,
        f.maxYear && `until ${f.maxYear}`,
        f.minRating && `${f.minRating}+ rating`,
    ]
        .filter(Boolean)
        .join(', ');
}

function hasAnyFilter(f) {
    return ['query', 'genre', 'stars', 'directors', 'minYear', 'maxYear', 'minRating'].some(
        (k) => f[k] !== undefined,
    );
}

export default function SearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // URL is the single source of truth for mode + query + filters.
    const mode = isValidMode(searchParams.get('mode')) ? searchParams.get('mode') : 'hybrid';
    const queryFromUrl = searchParams.get('q') ?? '';
    const urlFilters = mode === 'structural' ? filtersFromParams(searchParams) : null;

    const [input, setInput] = useState(queryFromUrl);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [meta, setMeta] = useState(null);
    const [searched, setSearched] = useState('');
    const [view, setView] = useViewMode();
    const { history, recordSearch, clearHistory } = useSearchHistory();

    // Monotonic generation: responses from an older mode/search are ignored.
    const generationRef = useRef(0);

    const runTextSearch = useCallback(async (query, searchMode) => {
        const gen = ++generationRef.current;
        if (!query.trim()) {
            setLoading(false);
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
            if (generationRef.current !== gen) return; // stale — a newer search started
            setResults(data.results ?? []);
            setMeta({
                message,
                exact_matches: data.exact_matches ?? null,
                total: data.total ?? data.results?.length ?? 0,
            });
            setSearched(query.trim());
            recordSearch(query.trim(), searchMode, new URLSearchParams({ q: query.trim(), mode: searchMode }));
        } catch (err) {
            if (generationRef.current !== gen) return;
            console.error('Search failed:', err);
            setError(err.message || 'Search failed. Is the backend running?');
            setResults([]);
            setMeta(null);
        } finally {
            if (generationRef.current === gen) setLoading(false);
        }
    }, [recordSearch]);

    const runStructuralSearch = useCallback(async (filters) => {
        const gen = ++generationRef.current;
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
            if (generationRef.current !== gen) return;
            setResults(data.results ?? []);
            setMeta({ message: null, exact_matches: null, total: data.total ?? data.results?.length ?? 0 });
            const label = filtersLabel(filters) || 'all movies';
            setSearched(label);
            // Reproduce this search via its structural URL params.
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
            recordSearch(label, 'structural', sp);
        } catch (err) {
            if (generationRef.current !== gen) return;
            console.error('Search failed:', err);
            setError(err.message || 'Search failed. Is the backend running?');
            setResults([]);
            setMeta(null);
        } finally {
            if (generationRef.current === gen) setLoading(false);
        }
    }, [recordSearch]);

    const clearResults = useCallback(() => {
        generationRef.current += 1; // invalidate any in-flight search
        setLoading(false);
        setError(null);
        setResults([]);
        setMeta(null);
        setSearched('');
    }, []);

    // Drive searches purely from URL changes (navigation, back/forward, mode chip).
    useEffect(() => {
        setInput(queryFromUrl);
        if (mode === 'structural') {
            if (hasAnyFilter(urlFilters)) {
                runStructuralSearch(urlFilters);
            } else {
                clearResults();
            }
        } else if (queryFromUrl.trim()) {
            runTextSearch(queryFromUrl, mode);
        } else {
            clearResults();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, queryFromUrl, searchParams]);

    const submitText = (e) => {
        e?.preventDefault?.();
        const q = input.trim();
        if (!q) return;
        setSearchParams({ q, mode });
    };

    const submitStructural = (filters) => {
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
    };

    // Mode switch only rewrites the URL, preserving the query text so that
    // toggling back to a text mode re-runs the SAME search. Structural-only
    // filter params are stripped when leaving structural mode; structural
    // mode itself ignores `q`. The URL effect does the rest.
    const switchMode = (id) => {
        const sp = new URLSearchParams(searchParams);
        sp.set('mode', id);
        if (id !== 'structural') {
            ['title', 'genre', 'actor', 'director', 'min_year', 'max_year', 'min_rating', 'sort_by', 'sort_order'].forEach((k) => sp.delete(k));
            if (!sp.get('q') && input.trim()) sp.set('q', input.trim());
        }
        setSearchParams(sp);
    };

    const showSearchBar = TEXT_MODES.includes(mode);
    const activeStructuralFilters = mode === 'structural' ? urlFilters : null;

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
                            autoFocus={showSearchBar}
                        />
                        <button type="submit" className="search-bar-button">Search</button>
                    </form>
                ) : (
                    <MetadataForm key={JSON.stringify(activeStructuralFilters || {})} initial={urlFilters} onSearch={submitStructural} />
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
                        <button className="search-retry" onClick={() => (mode === 'structural' ? submitStructural(urlFilters) : runTextSearch(input, mode))}>Try Again</button>
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

                {!loading && !error && !searched && (
                    <div className="search-idle">
                        {history.length > 0 ? (
                            <>
                                <div className="history-header">
                                    <h3 className="history-title">Recent searches</h3>
                                    <button className="history-clear" onClick={clearHistory} title="Clear history">
                                        Clear
                                    </button>
                                </div>
                                <div className="history-chips">
                                    {history.map((entry) => (
                                        <button
                                            key={entry.ts + entry.params}
                                            className="history-chip"
                                            title={`Search ${entry.mode}`}
                                            onClick={() => navigate(`/search?${entry.params}`)}
                                        >
                                            <span className="history-chip-label">{entry.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="search-idle-hint">
                                {showSearchBar
                                    ? 'Enter a query above — or switch modes to search a different way.'
                                    : 'Set some fields above, then press Search movies.'}
                            </p>
                        )}
                    </div>
                )}
            </section>

            <a className="search-home-link" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                ← Back to Home
            </a>
        </div>
    );
}