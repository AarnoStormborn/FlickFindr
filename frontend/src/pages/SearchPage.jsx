import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import MovieCard from '../components/MovieCard';
import MovieListTable from '../components/MovieListTable';
import ViewToggle from '../components/ViewToggle';
import { hybridSearch, semanticSearch, searchMovies } from '../api/movies';
import useViewMode from '../hooks/useViewMode';
import './SearchPage.css';

const MODES = [
    { id: 'hybrid', label: 'Hybrid', description: 'Agent-parsed · best for natural language' },
    { id: 'semantic', label: 'Semantic', description: 'Match by plot description' },
    { id: 'structural', label: 'Structural', description: 'Filters & sort by title/genre' },
];

export default function SearchPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const queryFromUrl = searchParams.get('q') ?? '';
    const modeFromUrl = searchParams.get('mode') ?? 'hybrid';

    const [input, setInput] = useState(queryFromUrl);
    const [mode, setMode] = useState(MODES.some((m) => m.id === modeFromUrl) ? modeFromUrl : 'hybrid');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [meta, setMeta] = useState(null); // { message, exact_matches, total }
    const [searched, setSearched] = useState('');
    const [view, setView] = useViewMode();

    const runSearch = useCallback(
        async (query, searchMode) => {
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
        },
        [],
    );

    // Sync URL state into the page + trigger search on navigation.
    useEffect(() => {
        setInput(queryFromUrl);
        setMode(MODES.some((m) => m.id === modeFromUrl) ? modeFromUrl : 'hybrid');
        if (queryFromUrl) {
            runSearch(queryFromUrl, MODES.some((m) => m.id === modeFromUrl) ? modeFromUrl : 'hybrid');
        }
    }, [queryFromUrl, modeFromUrl, runSearch]);

    const submit = (e) => {
        e?.preventDefault?.();
        setSearchParams({ q: input.trim(), mode });
        runSearch(input, mode);
    };

    const switchMode = (id) => {
        setMode(id);
        if (input.trim()) {
            setSearchParams({ q: input.trim(), mode: id });
            runSearch(input, id);
        }
    };

    return (
        <div className="search-page">
            <section className="search-hero">
                <h1 className="search-title">Find your next movie</h1>
                <p className="search-subtitle">
                    Describe it in your own words — "a prison escape about friendship" — or filter by genre and rating.
                </p>

                <form className="search-bar" onSubmit={submit} role="search">
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
                        <button className="search-retry" onClick={() => runSearch(input, mode)}>Try Again</button>
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
                                        {typeof meta.total === 'number' && mode === 'structural' && ` · ${meta.total} matches`}
                                    </p>
                                )}
                                {mode !== 'structural' && !meta.message && (
                                    <p className="search-message">{results.length} movies</p>
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
                    <div className="search-empty">
                        <p>Enter a query above — try comparing modes to see the difference.</p>
                    </div>
                )}
            </section>

            <a className="search-home-link" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                ← Back to Home
            </a>
        </div>
    );
}