/**
 * Plain-language explanation of why a plot-search result is where it is.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not print the raw cosine similarity as a percentage. A genuinely
 *    good plot match scores around 0.4-0.5 with this model, so "45% match" reads
 *    as a failure when it is the intended behaviour.
 *  - It does not pretend the number is comparable *between* queries. Embedding
 *    similarities are only meaningful relative to the other results for the same
 *    query, so the label is expressed against the closest result on the page, and
 *    says so.
 *
 * Above all it should be true: if the strength is only "related", say related.
 */

const STRONG = 0.92;
const RELATED = 0.82;

/**
 * @param similarity this result's similarity score (0..1 cosine)
 * @param topSimilarity the best score in the same result set
 * @returns {text, title} or null when there is nothing to say
 */
export function matchLabel(similarity, topSimilarity) {
    if (typeof similarity !== 'number' || !Number.isFinite(similarity)) return null;
    if (typeof topSimilarity !== 'number' || !Number.isFinite(topSimilarity) || topSimilarity <= 0) {
        return { text: 'Plot match', title: 'Matched by how closely the plot reads like your description.' };
    }

    const ratio = similarity / topSimilarity;
    const relative = `${Math.round(ratio * 100)}% of the closest result on this page`;
    const title = `Matched by how closely the plot reads like your description — ${relative}.`;

    if (ratio >= 1) return { text: 'Closest match', title };
    if (ratio >= STRONG) return { text: 'Strong match', title };
    if (ratio >= RELATED) return { text: 'Related match', title };
    return { text: 'Loose match', title };
}
