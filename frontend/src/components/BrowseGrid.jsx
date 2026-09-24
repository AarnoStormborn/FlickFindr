import { useEffect, useMemo, useState } from 'react';
import MovieCard from './MovieCard';
import { searchMovies, MAX_RESULTS } from '../api/movies';
import LoadingQuips from './LoadingQuips';

const MOVIES_PER_PAGE = 20;

/**
 * The shared body of a filtered browse page: fetch, sort, grid, pagination.
 *
 * Genre, era and mood pages were three copies of the same hundred lines, which
 * meant every change to the sort controls had to be made three times. They now
 * differ only in the filters they pass and the sorts they offer.
 *
 * `sortOptions` is [{ value, label }] in display order — a page offers only the
 * sorts that mean something for it (a year sort is pointless on a single decade).
 */
export default function BrowseGrid({
    filters,
    title,
    subtitle,
    countLabel = 'movies',
    sortOptions = [],
    emptyText = 'No movies found',
}) {
    const [movies, setMovies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [sortBy, setSortBy] = useState('rating');
    const [sortOrder, setSortOrder] = useState('desc');

    // Callers build `filters` inline, so it is a new object every render. Keying
    // the effect on its *value* keeps the fetch from re-running forever without
    // an eslint-disable hiding a real dependency.
    const filtersKey = JSON.stringify(filters ?? null);
    const stableFilters = useMemo(() => JSON.parse(filtersKey), [filtersKey]);

    useEffect(() => {
        let cancelled = false;
        const fetchMovies = async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await searchMovies({
                    ...stableFilters,
                    sortBy,
                    sortOrder,
                    skip: page * MOVIES_PER_PAGE,
                    limit: MOVIES_PER_PAGE,
                });
                if (cancelled) return;
                setMovies(response.results ?? []);
                setTotal(response.total ?? 0);
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to fetch movies:', err);
                setError('Failed to load movies');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchMovies();
        return () => {
            cancelled = true;
        };
    }, [stableFilters, page, sortBy, sortOrder]);

    const handleSortChange = (next) => {
        if (next === sortBy) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(next);
            setSortOrder('desc');
        }
        setPage(0);
    };

    // The API refuses a skip beyond MAX_RESULTS, so the UI must not offer pages
    // it cannot fetch. A genre with 13,540 films still shows only the first 100,
    // and paging is capped to match instead of failing on page 6.
    const reachable = Math.min(total, MAX_RESULTS);
    const totalPages = Math.ceil(reachable / MOVIES_PER_PAGE);

    return (
        <>
            <header className="genre-header">
                <h1 className="genre-title">{title}</h1>
                <p className="genre-count">
                    {subtitle ? `${subtitle} · ` : ''}
                    {total > MAX_RESULTS
                        ? `Top ${MAX_RESULTS} of ${total.toLocaleString()} ${countLabel}`
                        : `${total.toLocaleString()} ${countLabel}`}
                </p>
            </header>

            {sortOptions.length > 0 && (
                <div className="genre-controls">
                    <span className="controls-label">Sort by:</span>
                    <div className="sort-buttons">
                        {sortOptions.map((opt) => (
                            <button
                                key={opt.value}
                                className={`sort-btn ${sortBy === opt.value ? 'active' : ''}`}
                                onClick={() => handleSortChange(opt.value)}
                            >
                                {opt.label} {sortBy === opt.value && (sortOrder === 'desc' ? '↓' : '↑')}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {loading ? (
                <div className="genre-loading">
                    <div className="loading-spinner"></div>
                    <LoadingQuips />
                </div>
            ) : error ? (
                <div className="genre-error">
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>Try Again</button>
                </div>
            ) : movies.length === 0 ? (
                <div className="genre-error">
                    <p>{emptyText}</p>
                </div>
            ) : (
                <>
                    <div className="movies-grid">
                        {movies.map((movie) => (
                            <MovieCard key={movie.id} movie={movie} />
                        ))}
                    </div>

                    {totalPages > 1 && (
                        <div className="pagination">
                            <button
                                className="pagination-btn"
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                ← Previous
                            </button>
                            <span className="pagination-info">
                                Page {page + 1} of {totalPages}
                            </span>
                            <button
                                className="pagination-btn"
                                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                            >
                                Next →
                            </button>
                        </div>
                    )}
                </>
            )}
        </>
    );
}
