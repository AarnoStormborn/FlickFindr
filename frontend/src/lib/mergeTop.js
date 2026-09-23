/**
 * Merge multiple movie result sets into one row (dedupe by id, keep top N).
 *
 * The home page builds a genre row from several genre fetches, so it has to
 * decide an order across them. That decision must use the server's
 * `weighted_rating`, not the raw `rating`: each fetch already comes back ranked
 * by the vote-weighted score, and re-deciding the order from the raw rating here
 * silently undid the weighting and put a 143-vote 9.9 film on top of the row.
 *
 * Falls back to the raw rating only when the field is absent (older responses).
 */
export function mergeTop(perFetch, top = 15) {
    const seen = new Set();
    const merged = [];
    const rank = (m) => m.weighted_rating ?? m.rating ?? 0;
    perFetch
        .flatMap((res) => res.results ?? [])
        .sort((a, b) => rank(b) - rank(a))
        .forEach((m) => {
            if (seen.has(m.id)) return;
            seen.add(m.id);
            merged.push(m);
        });
    return merged.slice(0, top);
}
