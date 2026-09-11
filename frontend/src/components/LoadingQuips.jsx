import { useEffect, useState } from 'react';
import './LoadingQuips.css';

/**
 * Playful loading messages that rotate while a request is in flight and
 * escalate when the wait is long (Render's free tier sleeps, so the first
 * request of a session can take tens of seconds).
 *
 * Tier 1 = quick movie-flavoured quips, rotated every ROTATE_MS.
 * Tier 2 = honest "the server is waking up" jokes, shown after ESCALATE_MS.
 *
 * Honours prefers-reduced-motion by showing one static line instead of
 * rotating.
 */

const ROTATE_MS = 2500;
const ESCALATE_MS = 6000;

const QUICK = [
    'Rolling the film…',
    'Warming up the projector…',
    'Threading the reel…',
    'Dimming the lights…',
    'Adjusting the tracking…',
    'Shushing the row behind you…',
    'Buying overpriced popcorn…',
    'Rendering the unskippable studio logos…',
    'Checking for a post-credits scene…',
    'Consulting the Criterion shelf…',
    'Sorting by vibes…',
    'Reticulating cinephiles…',
    'Fast-forwarding through the trailers…',
    'Confirming the book was better…',
    'Debating whether Die Hard is a Christmas movie…',
    'Arguing about the best Nolan film…',
];

const SLOW = [
    'The server was napping. We’re poking it…',
    'Waking the projectionist…',
    'The server stepped out for a smoke break…',
    'Bribing the server with popcorn…',
    'It’s not buffering, it’s method acting…',
    'The server is booting like a 1997 DVD player…',
    'Negotiating with the cloud…',
    'Paging the ghost in the machine…',
    'Waiting for the audience to stop talking…',
    'Teaching the model to appreciate French New Wave…',
];

/** Fisher–Yates shuffle (returns a new array). */
function shuffled(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(
        () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    );
    useEffect(() => {
        const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!mq) return undefined;
        const onChange = (event) => setReduced(event.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

export default function LoadingQuips({ className = '' }) {
    const reducedMotion = usePrefersReducedMotion();
    const [pool, setPool] = useState(() => shuffled(QUICK));
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (reducedMotion) return undefined;
        const rotate = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
        const escalate = setTimeout(() => {
            setPool(shuffled(SLOW));
            setIndex(0);
        }, ESCALATE_MS);
        return () => {
            clearInterval(rotate);
            clearTimeout(escalate);
        };
    }, [reducedMotion]);

    const text = reducedMotion ? 'Rolling the film…' : pool[index % pool.length];

    return (
        <p className={`loading-quips ${className}`.trim()}>
            {/* key restarts the fade animation on each new line */}
            <span key={text}>{text}</span>
        </p>
    );
}
