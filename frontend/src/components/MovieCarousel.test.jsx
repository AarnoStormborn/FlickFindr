import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MovieCarousel from './MovieCarousel';

const movies = [
  { id: 1, movie_name: 'One', rating: 8, poster_url: null, release_year: 2001 },
  { id: 2, movie_name: 'Two', rating: 7, poster_url: null, release_year: 2002 },
  { id: 3, movie_name: 'Three', rating: 6, poster_url: null, release_year: 2003 },
];

function renderCarousel(props = {}) {
  return render(
    <MemoryRouter>
      <MovieCarousel movies={movies} {...props} />
    </MemoryRouter>,
  );
}

describe('MovieCarousel', () => {
  beforeEach(() => {
    // jsdom reports zero widths, so make the track look scrollable.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, value: 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 });
    Element.prototype.scrollBy = vi.fn();
  });

  it('renders a card per movie with accessible scroll buttons', () => {
    renderCarousel();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByLabelText('Scroll left')).toBeInTheDocument();
    expect(screen.getByLabelText('Scroll right')).toBeInTheDocument();
  });

  it('scrolls the track when the right arrow is clicked', async () => {
    renderCarousel();
    await userEvent.click(screen.getByLabelText('Scroll right'));
    expect(Element.prototype.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number), behavior: 'smooth' }),
    );
    expect(Element.prototype.scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);
  });

  it('scrolls backwards from the left arrow', async () => {
    renderCarousel();
    await userEvent.click(screen.getByLabelText('Scroll left'));
    expect(Element.prototype.scrollBy.mock.calls[0][0].left).toBeLessThan(0);
  });

  it('shows skeletons while loading', () => {
    const { container } = renderCarousel({ isLoading: true });
    expect(container.querySelectorAll('.movie-card-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows an empty state when there are no movies', () => {
    renderCarousel({ movies: [] });
    expect(screen.getByText('No movies found')).toBeInTheDocument();
  });
});
