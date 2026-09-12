/**
 * Streaming chat client.
 *
 * The backend answers `POST /chat` with Server-Sent Events, so we cannot use
 * EventSource (which is GET-only). Instead we read the response body stream and
 * parse SSE frames by hand — buffering across chunk boundaries, since a single
 * `data:` line can be split across reads.
 */
import { API_BASE_URL } from './movies';

/** Parse one SSE frame ("data: {...}") into its JSON payload. */
function parseFrame(frame) {
    const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) return null;
    try {
        return JSON.parse(dataLines.join('\n'));
    } catch {
        return null;
    }
}

/**
 * Send a chat message and stream the reply.
 *
 * @param {object} options
 * @param {string} options.message        user message
 * @param {Array}  [options.history]     prior {role, content} turns
 * @param {AbortSignal} [options.signal] abort the request
 * @param {(text: string) => void} [options.onDelta]   incremental assistant text
 * @param {(movies: Array) => void} [options.onMovies] movies found by the agent
 * @param {(message: string) => void} [options.onError] error text from the stream
 * @returns {Promise<void>} resolves when the stream ends
 */
export async function streamChat({ message, history = [], signal, onDelta, onMovies, onError }) {
    const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal,
    });

    if (!response.ok) {
        // Non-streaming error (validation, agent disabled, cold start timeout).
        let detail = `Chat failed (HTTP ${response.status})`;
        try {
            const body = await response.json();
            if (body?.detail) detail = body.detail;
            else if (body?.message) detail = body.message;
        } catch {
            /* keep the status-based message */
        }
        throw new Error(detail);
    }
    if (!response.body) throw new Error('Streaming is not supported in this browser');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Frames are separated by a blank line.
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);

                const payload = parseFrame(frame);
                if (payload) {
                    if (typeof payload.delta === 'string') onDelta?.(payload.delta);
                    if (Array.isArray(payload.movies)) onMovies?.(payload.movies);
                    if (payload.error) onError?.(String(payload.error));
                }
                boundary = buffer.indexOf('\n\n');
            }
        }
    } finally {
        reader.cancel().catch(() => {});
    }
}
