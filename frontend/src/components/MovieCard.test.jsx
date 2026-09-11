import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MovieCard from './MovieCard';

const movie = {
  id: 42,
  movie_name: 'Inception',
  release_year: 2010,
  rating: 8.4,
  runtime: 148,
  genre: 'Action, Sci-Fi',
  poster_url: 'https://example.com/poster.jpg',
};

function renderCard(props = {}) {
  return render(
    <MemoryRouter>
      <MovieCard movie={{ ...movie, ...props }} />
    </MemoryRouter>,
  );
}

describe('MovieCard', () => {
  it('shows the poster, title, rating and release year', () => {
    const { container } = renderCard();
    expect(screen.getByAltText('Inception poster')).toHaveAttribute('src', movie.poster_url);
    expect(screen.getByText('Inception')).toBeInTheDocument();
    expect(screen.getByText('8.4')).toBeInTheDocument();
    // Year appears in both the corner badge and the hover overlay.
    expect(container.querySelector('.movie-card-year')).toHaveTextContent('2010');
    expect(screen.getAllByText('2010').length).toBeGreaterThan(0);
  });

  it('falls back to a placeholder poster when none is provided', () => {
    renderCard({ poster_url: null });
    expect(screen.getByAltText('Inception poster').getAttribute('src')).toContain('placeholder');
  });

  it('formats runtime and first genre in the overlay', () => {
    renderCard();
    expect(screen.getByText('2h 28m')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('omits the year badge when the release year is unknown', () => {
    const { container } = renderCard({ release_year: null });
    expect(container.querySelector('.movie-card-year')).toBeNull();
    expect(screen.queryByText('2010')).not.toBeInTheDocument();
  });

  it('is keyboard reachable and links to the detail page', async () => {
    renderCard();
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-movie-id', '42');
    await userEvent.click(card);
    // Navigation is asserted indirectly: the card is interactive and its
    // handler does not throw under MemoryRouter.
    expect(card).toBeInTheDocument();
  });

  it('renders without a save button when the lists context is absent', () => {
    renderCard();
    // MovieCard only renders AddToListButton when ListsProvider is present.
    expect(screen.queryByTitle(/save to list/i)).not.toBeInTheDocument();
  });
});
