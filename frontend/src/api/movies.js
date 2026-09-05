/**
 * API client for FlickFindr backend
 *
 * In-memory response cache: search results are deterministic per request,
 * so navigating away (movie detail) and back shows the same data instantly
 * instead of re-fetching. Cached payloads are shallow-cloned on return so
 * callers cannot mutate what the cache holds.
 */

const API_BASE_URL = 'http://127.0.0.1:8001';

const responseCache = new Map();
const inflight = new Map();
const CACHE_MAX = 200;

async function cachedFetch(key, fetcher) {
    const hit = responseCache.get(key);
    if (hit) return clonePayload(hit);
    // Coalesce concurrent identical requests (e.g. React StrictMode dev
    // double-mount fires the effect twice before the first resolves).
    const pending = inflight.get(key);
    if (pending) return clonePayload(await pending);
    const promise = fetcher()
        .then((data) => {
            responseCache.set(key, data);
            if (responseCache.size > CACHE_MAX) {
                const oldest = responseCache.keys().next().value;
                if (oldest !== undefined) responseCache.delete(oldest);
            }
            return data;
        })
        .finally(() => {
            inflight.delete(key);
        });
    inflight.set(key, promise);
    return clonePayload(await promise);
}

function clonePayload(data) {
    if (Array.isArray(data)) return data.map((x) => ({ ...x }));
    if (data && typeof data === 'object') return { ...data };
    return data;
}

const keyOf = (parts) => JSON.stringify(parts);

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
}

/**
 * Fetch all genres with movie counts
 */
export async function getGenres() {
    return cachedFetch(keyOf(['genres']), () =>
        fetchJson(`${API_BASE_URL}/search/genres`).then((d) => {
            if (!Array.isArray(d)) throw new Error('Failed to fetch genres');
            return d;
        }),
    );
}

/**
 * Fetch movie statistics
 */
export async function getStats() {
    return cachedFetch(keyOf(['stats']), () =>
        fetchJson(`${API_BASE_URL}/search/stats`).then((d) => {
            if (typeof d.total_movies !== 'number') throw new Error('Failed to fetch stats');
            return d;
        }),
    );
}

/**
 * Structural search with filters
 */
export async function searchMovies(params = {}) {
    const body = {};
    if (params.query) body.query = params.query;
    if (params.genre) body.genre = params.genre;
    if (params.directors) body.directors = params.directors;
    if (params.stars) body.stars = params.stars;
    if (params.minRating != null) body.min_rating = params.minRating;
    if (params.maxRating != null) body.max_rating = params.maxRating;
    if (params.minRuntime != null) body.min_runtime = params.minRuntime;
    if (params.maxRuntime != null) body.max_runtime = params.maxRuntime;
    body.sort_by = params.sortBy || 'rating';
    body.sort_order = params.sortOrder || 'desc';
    body.skip = params.skip || 0;
    body.limit = params.limit || 15;

    return cachedFetch(keyOf(['structural', body]), () =>
        fetchJson(`${API_BASE_URL}/search/structural`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((d) => {
            if (!Array.isArray(d.results)) throw new Error('Failed to search movies');
            return d;
        }),
    );
}

/**
 * Get movies by genre - convenience wrapper
 */
export async function getMoviesByGenre(genre, limit = 15) {
    return searchMovies({
        genre,
        sortBy: 'rating',
        sortOrder: 'desc',
        limit,
    });
}

/**
 * Get a specific movie by ID
 */
export async function getMovieById(id) {
    return cachedFetch(keyOf(['movie', id]), () =>
        fetchJson(`${API_BASE_URL}/flicks/movie/${id}`).then((d) => {
            if (!d.id) throw new Error(`Movie ${id} not found`);
            return d;
        }),
    );
}

/**
 * Semantic search using natural language
 */
export async function semanticSearch(query, limit = 10) {
    return cachedFetch(keyOf(['semantic', query.trim(), limit]), () =>
        fetchJson(`${API_BASE_URL}/search/semantic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query.trim(), limit }),
        }).then((d) => {
            if (!Array.isArray(d.results)) throw new Error('Semantic search failed');
            return d;
        }),
    );
}

/**
 * Hybrid search combining filters and semantic search
 */
export async function hybridSearch(params) {
    const body = {};
    body.query = params.query;
    if (params.genre) body.genre = params.genre;
    if (params.directors) body.directors = params.directors;
    if (params.stars) body.stars = params.stars;
    if (params.minRating != null) body.min_rating = params.minRating;
    if (params.maxRating != null) body.max_rating = params.maxRating;
    if (params.minRuntime != null) body.min_runtime = params.minRuntime;
    if (params.maxRuntime != null) body.max_runtime = params.maxRuntime;
    body.limit = params.limit || 10;

    return cachedFetch(keyOf(['hybrid', body]), () =>
        fetchJson(`${API_BASE_URL}/search/hybrid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((d) => {
            if (!Array.isArray(d.results)) throw new Error('Hybrid search failed');
            return d;
        }),
    );
}