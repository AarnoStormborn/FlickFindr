import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

/**
 * Routing smoke test: renders App at a given path and asserts the right page
 * mounts. Network is stubbed so pages render their shells without a backend.
 */

function routeFetch() {
  return vi.fn((url) => {
    const href = String(url);
    let body;
    if (href.includes('/search/genres')) {
      body = [{ name: 'Drama', count: 10 }];
    } else if (href.includes('/search/stats')) {
      body = { min_rating: 0, max_rating: 10, min_runtime: 0, max_runtime: 300, total_movies: 1 };
    } else if (/\/flicks\/movie\/\d+$/.test(href)) {
      // Detail page needs a real row, else the page logs a fetch error.
      body = { id: 1, movie_name: 'Inception', release_year: 2010, rating: 8.4, genre: 'Action, Sci-Fi' };
    } else if (href.includes('/trailers') || href.includes('/similar')) {
      body = { results: [] };
    } else {
      body = { results: [], total: 0, skip: 0, limit: 20, has_more: false };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
}

function renderAt(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

describe('App routing', () => {
  beforeEach(() => {
    globalThis.fetch = routeFetch();
  });

  it('renders the home page with its hero', async () => {
    renderAt('/');
    expect(screen.getByText(/Discover Your Next/i)).toBeInTheDocument();
    expect(document.querySelector('.movies-page')).toBeTruthy();
  });

  it('renders the search page', async () => {
    renderAt('/search');
    await waitFor(() => expect(screen.getByText(/Find your next movie/i)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Try '/i)).toBeInTheDocument();
  });

  it('renders the lists page', async () => {
    renderAt('/lists');
    // 'My Lists' is also a navbar link, so assert on the page heading.
    await waitFor(() => expect(document.querySelector('.lists-title')).toHaveTextContent('My Lists'));
  });

  it('renders the movie detail route', async () => {
    renderAt('/movie/1');
    await waitFor(() => expect(screen.getByText('Inception')).toBeInTheDocument());
    expect(document.querySelector('.movie-details-page')).toBeTruthy();
  });

  it('renders the genre route', async () => {
    renderAt('/genre/Drama');
    await waitFor(() => expect(document.querySelector('.genre-page')).toBeTruthy());
  });

  it('renders the era route', async () => {
    renderAt('/era/retro');
    await waitFor(() => expect(document.querySelector('.genre-page')).toBeTruthy());
  });

  it('always renders the navbar with navigation links', async () => {
    renderAt('/');
    const nav = document.querySelector('.navbar');
    expect(nav).toBeTruthy();
    expect(nav).toHaveTextContent('Home');
    expect(nav).toHaveTextContent('Search');
    expect(nav).toHaveTextContent('My Lists');
  });
});
