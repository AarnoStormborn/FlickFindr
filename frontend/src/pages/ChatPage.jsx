import { useCallback, useEffect, useRef, useState } from 'react';
import MovieCard from '../components/MovieCard';
import LoadingQuips from '../components/LoadingQuips';
import { streamChat } from '../api/chat';
import './ChatPage.css';

const SUGGESTIONS = [
    'A quiet movie about two strangers who slowly become friends',
    'Something like Blade Runner but funnier',
    'A high-energy heist film under two hours',
    'Best-reviewed animated films of the 2000s',
];

/**
 * The concierge: a conversational front door to the catalog.
 *
 * The backend agent searches the catalogue with tools and streams back prose
 * plus the movies it actually found, so replies render as real cards you can
 * click into rather than a wall of titles.
 */
export default function ChatPage() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState(null);

    const scrollRef = useRef(null);
    const abortRef = useRef(null);
    const inputRef = useRef(null);

    // Keep the newest turn in view as text streams in.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, streaming]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const send = useCallback(
        async (text) => {
            const message = text.trim();
            if (!message || streaming) return;

            setError(null);
            setInput('');

            // History is what the server already knows about; the new turn is
            // appended locally as the streaming assistant placeholder.
            const history = messages.map(({ role, content }) => ({ role, content }));
            setMessages((prev) => [
                ...prev,
                { role: 'user', content: message },
                { role: 'assistant', content: '', movies: [] },
            ]);
            setStreaming(true);

            const controller = new AbortController();
            abortRef.current = controller;

            const patchLast = (patch) =>
                setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === 'assistant') next[next.length - 1] = { ...last, ...patch };
                    return next;
                });

            try {
                await streamChat({
                    message,
                    history,
                    signal: controller.signal,
                    onDelta: (delta) =>
                        setMessages((prev) => {
                            const next = [...prev];
                            const last = next[next.length - 1];
                            if (last?.role === 'assistant') {
                                next[next.length - 1] = { ...last, content: last.content + delta };
                            }
                            return next;
                        }),
                    onMovies: (movies) => patchLast({ movies }),
                    onError: (msg) => setError(msg),
                });
            } catch (err) {
                if (err?.name !== 'AbortError') setError(err?.message || 'Something went wrong');
            } finally {
                abortRef.current = null;
                setStreaming(false);
                // Drop an assistant bubble that never received any content.
                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'assistant' && !last.content && !last.movies?.length) {
                        return prev.slice(0, -1);
                    }
                    return prev;
                });
                inputRef.current?.focus();
            }
        },
        [messages, streaming],
    );

    const onSubmit = (event) => {
        event.preventDefault();
        void send(input);
    };

    const onKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send(input);
        }
    };

    const stop = () => {
        abortRef.current?.abort();
        setStreaming(false);
    };

    const empty = messages.length === 0;

    return (
        <main className="chat-page">
            <header className="chat-header">
                <h1 className="chat-title">
                    The <em>Concierge</em>
                </h1>
                <p className="chat-subtitle">
                    Describe what you feel like watching. Ask for something like a film you loved.
                </p>
            </header>

            <div className="chat-scroll" ref={scrollRef}>
                {empty && (
                    <div className="chat-empty">
                        <p className="chat-empty-lead">Not sure what to watch? Start here:</p>
                        <ul className="chat-suggestions">
                            {SUGGESTIONS.map((s) => (
                                <li key={s}>
                                    <button type="button" className="chat-chip" onClick={() => void send(s)}>
                                        {s}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`chat-turn chat-turn-${msg.role}`}>
                        <div className={`chat-bubble chat-bubble-${msg.role}`}>
                            {msg.content ? (
                                <p className="chat-text">{msg.content}</p>
                            ) : (
                                msg.role === 'assistant' && <LoadingQuips />
                            )}
                        </div>

                        {!!msg.movies?.length && (
                            <div className="chat-movies">
                                {msg.movies.map((movie) => (
                                    <div className="chat-movie" key={movie.id}>
                                        <MovieCard movie={movie} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {streaming && messages[messages.length - 1]?.content && (
                    <div className="chat-typing" aria-live="polite">
                        <span />
                        <span />
                        <span />
                    </div>
                )}

                {error && (
                    <div className="chat-error" role="alert">
                        <strong>Couldn’t reach the concierge.</strong> {error}
                    </div>
                )}
            </div>

            <form className="chat-composer" onSubmit={onSubmit}>
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    rows={1}
                    placeholder="What do you feel like watching?"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={streaming}
                    aria-label="Message the concierge"
                />
                {streaming ? (
                    <button type="button" className="chat-send chat-stop" onClick={stop}>
                        Stop
                    </button>
                ) : (
                    <button type="submit" className="chat-send" disabled={!input.trim()}>
                        Send
                    </button>
                )}
            </form>
        </main>
    );
}
