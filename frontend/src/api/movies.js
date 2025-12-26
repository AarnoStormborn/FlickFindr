/**
 * API client for FlickFindr backend
 */

const API_BASE_URL = 'http://localhost:8000';

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
    const response = await fetch(`${API_BASE_URL}/search/structural`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            genre: params.genre || null,
            min_rating: params.minRating || null,
            max_rating: params.maxRating || null,
            sort_by: params.sortBy || 'rating',
            sort_order: params.sortOrder || 'desc',
            skip: params.skip || 0,
            limit: params.limit || 15,
        }),
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
    const response = await fetch(`${API_BASE_URL}/search/hybrid`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: params.query,
            genre: params.genre || null,
            min_rating: params.minRating || null,
            max_rating: params.maxRating || null,
            limit: params.limit || 10,
        }),
    });

    if (!response.ok) {
        throw new Error('Hybrid search failed');
    }
    return response.json();
}
