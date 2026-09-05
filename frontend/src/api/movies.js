/**
 * API client for FlickFindr backend
 */

const API_BASE_URL = 'http://127.0.0.1:8001';

/**
 * Fetch all genres with movie counts
 */
export async function getGenres() {
    const response = await fetch(`${API_BASE_URL}/search/genres`);
    if (!response.ok) {
        throw new Error('Failed to fetch genres');
    }
    return response.json();
}

/**
 * Fetch movie statistics
 */
export async function getStats() {
    const response = await fetch(`${API_BASE_URL}/search/stats`);
    if (!response.ok) {
        throw new Error('Failed to fetch stats');
    }
    return response.json();
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

    const response = await fetch(`${API_BASE_URL}/search/structural`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Failed to search movies');
    }
    return response.json();
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
    const response = await fetch(`${API_BASE_URL}/flicks/movie/${id}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch movie ${id}`);
    }
    return response.json();
}

/**
 * Semantic search using natural language
 */
export async function semanticSearch(query, limit = 10) {
    const response = await fetch(`${API_BASE_URL}/search/semantic`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
        throw new Error('Semantic search failed');
    }
    return response.json();
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

    const response = await fetch(`${API_BASE_URL}/search/hybrid`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Hybrid search failed');
    }
    return response.json();
}
