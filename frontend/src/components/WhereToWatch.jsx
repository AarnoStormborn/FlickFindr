import { useEffect, useState } from 'react';
import { getWatchProviders } from '../api/movies';
import useWatchRegion, { REGION_NAMES } from '../hooks/useWatchRegion';
import './WhereToWatch.css';

/**
 * "Where to watch" on the movie detail page.
 *
 * Providers differ per country, and the API stores the regions it is configured
 * for (India and the US), so this shows a region switcher when more than one has
 * data and remembers the choice.
 *
 * The section is additive: if the lookup fails or the film is on nothing, it
 * renders nothing or a single quiet line rather than an error, because "this
 * film isn't streaming anywhere we track" is not a failure of the page.
 */

/** Subscription / rental / purchase, in the order a viewer cares about them. */
const GROUPS = [
    { key: 'flatrate', label: 'Stream' },
    { key: 'rent', label: 'Rent' },
    { key: 'buy', label: 'Buy' },
];

export default function WhereToWatch({ movieId }) {
    // The payload records which movie it belongs to, so a stale response for a
    // previous film can never render, and no state is set synchronously in the
    // effect (which would cascade renders).
    const [state, setState] = useState({ movieId: null, payload: null, failed: false });
    const [region, setRegion] = useWatchRegion();

    useEffect(() => {
        let cancelled = false;
        getWatchProviders(movieId)
            .then((data) => {
                if (!cancelled) setState({ movieId, payload: data, failed: false });
            })
            .catch(() => {
                // A missing/failed lookup is not worth surfacing on a detail page.
                if (!cancelled) setState({ movieId, payload: null, failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [movieId]);

    if (state.movieId !== movieId || state.failed || !state.payload) return null;
    const payload = state.payload;

    const regions = payload.regions ?? [];
    if (regions.length === 0) {
        return (
            <section className="where-to-watch" aria-label="Where to watch">
                <h2 className="where-to-watch-title">Where to watch</h2>
                <p className="where-to-watch-empty">
                    Not on any streaming service we track in {REGION_NAMES[region] ?? region}.
                </p>
            </section>
        );
    }

    // Prefer the remembered region; fall back to whatever the API returned.
    const active = regions.find((r) => r.code === region) ?? regions[0];

    return (
        <section className="where-to-watch" aria-label="Where to watch">
            <div className="where-to-watch-head">
                <h2 className="where-to-watch-title">Where to watch</h2>
                {regions.length > 1 && (
                    <div className="where-to-watch-regions" role="group" aria-label="Region">
                        {regions.map((r) => (
                            <button
                                key={r.code}
                                type="button"
                                className={`where-to-watch-region ${r.code === active.code ? 'active' : ''}`}
                                aria-pressed={r.code === active.code}
                                onClick={() => setRegion(r.code)}
                            >
                                {REGION_NAMES[r.code] ?? r.code}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {GROUPS.map(({ key, label }) => {
                const providers = active[key] ?? [];
                if (providers.length === 0) return null;
                return (
                    <div className="where-to-watch-group" key={key}>
                        <h3 className="where-to-watch-group-label">{label}</h3>
                        <ul className="where-to-watch-list">
                            {providers.map((p) => (
                                <li className="where-to-watch-item" key={`${key}-${p.id ?? p.name}`}>
                                    {p.logo && (
                                        <img
                                            className="where-to-watch-logo"
                                            src={p.logo}
                                            alt=""
                                            loading="lazy"
                                            width="28"
                                            height="28"
                                        />
                                    )}
                                    <span className="where-to-watch-name">{p.name}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}

            {/* TMDB's terms require attributing this data to JustWatch. */}
            <p className="where-to-watch-attribution">
                {active.link ? (
                    <a href={active.link} target="_blank" rel="noreferrer noopener">
                        {payload.attribution?.text ?? 'Watch provider data provided by JustWatch'}
                    </a>
                ) : (
                    payload.attribution?.text ?? 'Watch provider data provided by JustWatch'
                )}
            </p>
        </section>
    );
}
