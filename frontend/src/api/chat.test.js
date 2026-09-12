import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './chat';

/** Build a fake fetch response whose body streams the given chunks. */
function streamResponse(chunks, { status = 200, json } = {}) {
    if (json !== undefined) {
        return {
            ok: status < 400,
            status,
            json: async () => json,
        };
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
    return { ok: status < 400, status, body };
}

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('streamChat', () => {
    it('streams assistant deltas in order', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                streamResponse([sse({ delta: 'Try ' }), sse({ delta: 'Alien.' }), sse({ done: true })]),
            ),
        );

        const deltas = [];
        await streamChat({ message: 'hi', onDelta: (d) => deltas.push(d) });

        expect(deltas.join('')).toBe('Try Alien.');
    });

    it('surfaces movies sent by the agent', async () => {
        const movies = [{ id: 1, movie_name: 'Alien' }];
        vi.stubGlobal('fetch', vi.fn(async () => streamResponse([sse({ movies }), sse({ done: true })])));

        const seen = [];
        await streamChat({ message: 'hi', onMovies: (m) => seen.push(m) });

        expect(seen).toEqual([movies]);
    });

    it('reports an error payload from the stream', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => streamResponse([sse({ error: 'model exploded' })])));

        const errors = [];
        await streamChat({ message: 'hi', onError: (e) => errors.push(e) });

        expect(errors).toEqual(['model exploded']);
    });

    it('reassembles a frame split across chunk boundaries', async () => {
        // Exactly how a network read can split one SSE frame mid-JSON.
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => streamResponse(['data: {"del', 'ta": "split', ' ok"}\n\n'])),
        );

        const deltas = [];
        await streamChat({ message: 'hi', onDelta: (d) => deltas.push(d) });

        expect(deltas).toEqual(['split ok']);
    });

    it('handles multiple frames arriving in a single chunk', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => streamResponse([sse({ delta: 'a' }) + sse({ delta: 'b' }) + sse({ delta: 'c' })])),
        );

        const deltas = [];
        await streamChat({ message: 'hi', onDelta: (d) => deltas.push(d) });

        expect(deltas).toEqual(['a', 'b', 'c']);
    });

    it('ignores heartbeats and unparseable frames', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => streamResponse(['retry: 3000\n\n', 'data: not-json\n\n', sse({ delta: 'ok' })])),
        );

        const deltas = [];
        await streamChat({ message: 'hi', onDelta: (d) => deltas.push(d) });

        expect(deltas).toEqual(['ok']);
    });

    it('sends the message and prior history as JSON', async () => {
        const fetchMock = vi.fn(async () => streamResponse([sse({ done: true })]));
        vi.stubGlobal('fetch', fetchMock);

        await streamChat({
            message: 'and something shorter?',
            history: [{ role: 'user', content: 'a heist film' }],
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/chat$/);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            message: 'and something shorter?',
            history: [{ role: 'user', content: 'a heist film' }],
        });
    });

    it('throws with the server detail when the response is not ok', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => streamResponse(null, { status: 503, json: { detail: 'Agent chat is disabled' } })),
        );

        await expect(streamChat({ message: 'hi' })).rejects.toThrow('Agent chat is disabled');
    });

    it('falls back to a status message when the error body has no detail', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => streamResponse(null, { status: 500, json: {} })));

        await expect(streamChat({ message: 'hi' })).rejects.toThrow('HTTP 500');
    });
});
