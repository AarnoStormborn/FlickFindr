import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * API client tests. The module keeps a module-level response cache, so each
 * test re-imports it fresh via vi.resetModules().
 */

async function loadApi() {
  vi.resetModules();
  return import('./movies.js');
}

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
}

describe('searchMovies request shaping', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [], total: 0, skip: 0, limit: 20, has_more: false }));
  });

  it('omits unset optional filters instead of sending null', async () => {
    const api = await loadApi();
    await api.searchMovies({ genre: 'Drama', limit: 20 });

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.genre).toBe('Drama');
    // The regression that broke the home page: nulls were rejected by the API.
    expect(body).not.toHaveProperty('min_rating');
    expect(body).not.toHaveProperty('max_rating');
    expect(body).not.toHaveProperty('min_runtime');
    expect(body).not.toHaveProperty('max_runtime');
    expect(body).not.toHaveProperty('min_year');
    expect(body).not.toHaveProperty('max_year');
    expect(body).not.toHaveProperty('query');
    expect(body).not.toHaveProperty('min_votes');
  });

  it('maps camelCase params to snake_case API fields, including year/votes', async () => {
    const api = await loadApi();
    await api.searchMovies({
      query: 'dark',
      minRating: 7,
      maxRating: 9,
      minRuntime: 90,
      maxRuntime: 180,
      minYear: 1990,
      maxYear: 1999,
      minVotes: 1000,
      sortBy: 'release_year',
      sortOrder: 'asc',
      skip: 20,
      limit: 30,
    });

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      query: 'dark',
      min_rating: 7,
      max_rating: 9,
      min_runtime: 90,
      max_runtime: 180,
      min_year: 1990,
      max_year: 1999,
      min_votes: 1000,
      sort_by: 'release_year',
      sort_order: 'asc',
      skip: 20,
      limit: 30,
    });
  });

  it('posts to the structural endpoint', async () => {
    const api = await loadApi();
    await api.searchMovies({ query: 'x' });
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/search/structural');
    expect(globalThis.fetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('response caching', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [{ id: 1 }], total: 1, skip: 0, limit: 20, has_more: false }));
  });

  it('serves an identical request from cache without refetching', async () => {
    const api = await loadApi();
    await api.searchMovies({ genre: 'Drama', limit: 20 });
    await api.searchMovies({ genre: 'Drama', limit: 20 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches again when the request differs', async () => {
    const api = await loadApi();
    await api.searchMovies({ genre: 'Drama', limit: 20 });
    await api.searchMovies({ genre: 'Comedy', limit: 20 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent identical requests (StrictMode double-effect)', async () => {
    const api = await loadApi();
    const [a, b] = await Promise.all([
      api.searchMovies({ genre: 'Drama', limit: 20 }),
      api.searchMovies({ genre: 'Drama', limit: 20 }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('returns clones so callers cannot mutate the cached payload', async () => {
    const api = await loadApi();
    const first = await api.searchMovies({ genre: 'Drama', limit: 20 });
    first.results[0].id = 999;
    const second = await api.searchMovies({ genre: 'Drama', limit: 20 });
    expect(second.results[0].id).toBe(1);
  });
});

describe('error handling', () => {
  it('throws when the API responds with an error status', async () => {
    globalThis.fetch = vi.fn(() => jsonResponse({ detail: 'boom' }, false));
    const api = await loadApi();
    await expect(api.searchMovies({ query: 'x' })).rejects.toThrow();
  });

  it('does not cache failures', async () => {
    globalThis.fetch = vi.fn(() => jsonResponse({ detail: 'boom' }, false));
    const api = await loadApi();
    await expect(api.searchMovies({ query: 'x' })).rejects.toThrow();
    // A retry must hit the network again rather than replaying the failure.
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [], total: 0, skip: 0, limit: 20, has_more: false }));
    await expect(api.searchMovies({ query: 'x' })).resolves.toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('endpoint helpers', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [] }));
  });

  it('getMovieTrailers unwraps results', async () => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [{ key: 'abc' }] }));
    const api = await loadApi();
    expect(await api.getMovieTrailers(7)).toEqual([{ key: 'abc' }]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/flicks/movie/7/trailers');
  });

  it('getSimilarMovies passes the limit and unwraps results', async () => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [{ id: 2 }] }));
    const api = await loadApi();
    expect(await api.getSimilarMovies(7, 5)).toEqual([{ id: 2 }]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/flicks/movie/7/similar?limit=5');
  });

  it('semanticSearch sends skip for pagination', async () => {
    globalThis.fetch = vi.fn(() => jsonResponse({ results: [], message: 'ok' }));
    const api = await loadApi();
    await api.semanticSearch('prison escape', 20, 40);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ query: 'prison escape', limit: 20, skip: 40 });
  });
});
