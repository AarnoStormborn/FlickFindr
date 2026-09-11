import { useEffect, useState } from 'react';
import { QUICK_QUIPS, SLOW_QUIPS } from './quipPools';
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
    const [pool, setPool] = useState(() => shuffled(QUICK_QUIPS));
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (reducedMotion) return undefined;
        const rotate = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
        const escalate = setTimeout(() => {
            setPool(shuffled(SLOW_QUIPS));
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
