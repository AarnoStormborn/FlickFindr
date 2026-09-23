/**
 * Display formatting for values that arrive as raw data.
 *
 * These live together because both were previously defined per-component: the
 * runtime formatter existed twice, byte for byte, in MovieCard and
 * MovieListTable.
 */

/**
 * "1h 29m" / "45m" for a duration in minutes.
 * @returns {string|null} null when there is no duration, so callers can omit it
 */
export function formatRuntime(minutes) {
    if (!minutes) return null;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/** Built once: constructing an Intl formatter per render is comparatively costly. */
const COMPACT_USD = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
});

/**
 * Compact box office: 40060108 → "$40.1M", 2780000000 → "$2.8B".
 *
 * The database stores raw dollars (`gross` is a text column holding the exact
 * figure from TMDB), so the shortening belongs here rather than in the data. A
 * film with no recorded revenue, or a 0 placeholder, returns null so the row is
 * omitted instead of claiming "$0" — for 56% of the catalogue the figure is
 * genuinely unknown.
 *
 * @param {string|number|null|undefined} value raw dollars
 * @returns {string|null}
 */
export function formatMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return COMPACT_USD.format(amount);
}
