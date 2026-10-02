import { useEffect, useState } from 'react';
import { getRatings } from '../api/movies';
import './Ratings.css';

/**
 * Third-party ratings on the movie detail page: IMDb, Rotten Tomatoes, Metacritic.
 *
 * These are not our own `rating` (TMDB's average) — they are the scores a visitor
 * already recognises, which is why the page shows them at all.
 *
 * Additive like "Where to watch": if the lookup fails, or the film genuinely has no
 * scores, or the server has no OMDb key configured, this renders **nothing**. An
 * empty ratings strip would be noise on every film that lacks one, and an error
 * message about a third-party provider is not the viewer's problem.
 */
const SOURCES = [
    { key: 'imdb', label: 'IMDb', href: (r) => `https://www.imdb.com/title/${r.imdb_id}/`, format: (s) => s.score.toFixed(1) },
    { key: 'rotten_tomatoes', label: 'Rotten Tomatoes', short: 'RT', href: () => null, format: (s) => `${s.score}%` },
    { key: 'metacritic', label: 'Metacritic', short: 'MC', href: () => null, format: (s) => `${s.score}` },
];

export default function Ratings({ movieId }) {
    // The payload names the film it belongs to, so a stale response for a previous
    // movie can never render here.
    const [state, setState] = useState({ movieId: null, payload: null, failed: false });

    useEffect(() => {
        let cancelled = false;
        getRatings(movieId)
            .then((data) => {
                if (!cancelled) setState({ movieId, payload: data, failed: false });
            })
            .catch(() => {
                // Includes the "server has no OMDb key" 503: stay quiet.
                if (!cancelled) setState({ movieId, payload: null, failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [movieId]);

    if (state.movieId !== movieId || state.failed || !state.payload) return null;
    const ratings = state.payload.ratings;
    if (!ratings) return null;

    const shown = SOURCES.filter((s) => ratings[s.key]);
    if (shown.length === 0) return null;

    return (
        <ul className="ratings" aria-label="Ratings from other sites">
            {shown.map((source) => {
                const score = ratings[source.key];
                const href = source.href(ratings);
                const content = (
                    <>
                        <span className="ratings-source">{source.short ?? source.label}</span>
                        <span className="ratings-score">{source.format(score)}</span>
                    </>
                );
                return (
                    <li key={source.key} className={`ratings-item ratings-${source.key}`} title={`${source.label} rating`}>
                        {href ? (
                            <a href={href} target="_blank" rel="noreferrer noopener" className="ratings-link">
                                {content}
                            </a>
                        ) : (
                            <span className="ratings-link">{content}</span>
                        )}
                    </li>
                );
            })}
            <li className="ratings-source-note" aria-hidden="true">
                via OMDb
            </li>
        </ul>
    );
}
