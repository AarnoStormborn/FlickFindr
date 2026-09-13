import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { streamChat } from '../api/chat';

/**
 * Streaming behaviour of the concierge.
 *
 * The bug these guard against: movie cards were rendered as they arrived, so
 * the strip rewrote itself on every tool call — cards appeared, swapped,
 * vanished and returned. Cards are now buffered until the turn ends.
 */
vi.mock('../api/chat', () => ({ streamChat: vi.fn() }));

const MOVIES = [
    { id: 1, movie_name: 'The Usual Suspects', release_year: 1995, rating: 8.2, runtime: 106, genre: 'Crime', poster_url: null },
    { id: 2, movie_name: 'Gattaca', release_year: 1997, rating: 7.6, runtime: 106, genre: 'Sci-Fi', poster_url: null },
];

function renderChat() {
    window.history.pushState({}, '', '/chat');
    return render(<App />);
}

/** Drive the composer: type a message and submit. */
async function sendMessage(text) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Message the concierge/i), text);
    await user.click(screen.getByRole('button', { name: /send/i }));
}

describe('Concierge streaming', () => {
    beforeEach(() => {
        vi.mocked(streamChat).mockReset();
        globalThis.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [], total: 0 }) }),
        );
    });

    it('does not render cards until the turn ends, then reveals them', async () => {
        let finish;
        vi.mocked(streamChat).mockImplementation(async ({ onDelta, onMovies }) => {
            onDelta('Here are my picks.');
            onMovies(MOVIES);
            // Turn is still in flight: cards must stay hidden.
            await new Promise((resolve) => {
                finish = resolve;
            });
        });

        renderChat();
        await sendMessage('a heist movie');

        await waitFor(() => expect(screen.getByText('Here are my picks.')).toBeInTheDocument());
        // The agent already reported movies, but the text is still streaming.
        expect(document.querySelectorAll('.chat-movies .movie-card')).toHaveLength(0);

        finish();
        await waitFor(() => expect(document.querySelectorAll('.chat-movies .movie-card')).toHaveLength(2));
        expect(screen.getByText('The Usual Suspects')).toBeInTheDocument();
    });

    it('shows each card exactly once when the agent reports movies repeatedly', async () => {
        let finish;
        vi.mocked(streamChat).mockImplementation(async ({ onMovies }) => {
            // Each tool call replaces the candidate set, as the real agent does.
            onMovies([MOVIES[0]]);
            onMovies([MOVIES[1]]);
            onMovies([MOVIES[0], MOVIES[1]]);
            await new Promise((resolve) => {
                finish = resolve;
            });
        });

        renderChat();
        await sendMessage('anything');
        finish();

        await waitFor(() => expect(document.querySelectorAll('.chat-movies .movie-card')).toHaveLength(2));
        // Not 4 — earlier candidate sets are discarded, not accumulated.
        expect(document.querySelectorAll('.chat-movies .movie-card')).toHaveLength(2);
    });

    it('surfaces an error from the stream', async () => {
        vi.mocked(streamChat).mockImplementation(async ({ onError }) => {
            onError('The concierge is busy right now.');
        });

        renderChat();
        await sendMessage('anything');

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/busy right now/i));
    });

    it('drops an assistant bubble that produced neither text nor cards', async () => {
        vi.mocked(streamChat).mockImplementation(async () => {});

        renderChat();
        await sendMessage('anything');

        await waitFor(() => expect(document.querySelectorAll('.chat-bubble-assistant')).toHaveLength(0));
    });

    it('renders results in a three-column grid class', async () => {
        vi.mocked(streamChat).mockImplementation(async ({ onMovies }) => {
            onMovies(MOVIES);
        });

        renderChat();
        await sendMessage('anything');

        await waitFor(() => expect(document.querySelector('.chat-movies')).toBeTruthy());
        // Column count itself is CSS; assert the container the grid rules target.
        expect(document.querySelectorAll('.chat-movies .chat-movie')).toHaveLength(2);
    });
});
