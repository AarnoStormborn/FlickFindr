/**
 * Third-party ratings (IMDb, Rotten Tomatoes, Metacritic) via OMDb.
 *
 * Why a second provider: TMDB carries no IMDb/RT/Metacritic scores, and the page's
 * own `rating` is TMDB's average, which is a different thing from an IMDb score a
 * visitor recognises. OMDb returns all three in one request.
 *
 * Lookups are by `imdb_id` (from TMDB's `/external_ids`) rather than by title, because
 * titles are ambiguous — "Titanic" matches a 1953, a 1997 and a 2010 film.
 *
 * The free tier is 1,000 requests/day and non-commercial, which rules out a catalogue
 * backfill (30k films = a month) and is exactly why this is fetched on demand and
 * cached in the database: only films somebody actually opens cost a request.
 */
import { logger } from "./logger.js";

const BASE = "https://www.omdbapi.com";
const API_KEY = (): string => process.env.OMDB_API_KEY ?? "";

export function omdbConfigured(): boolean {
    return API_KEY() !== "";
}

export interface ExternalRatings {
    /** IMDb id, kept so the UI can link out without another lookup. */
    imdb_id: string | null;
    imdb: { score: number; votes: number | null } | null;
    /** Rotten Tomatoes, as the percentage OMDb reports ("91%" -> 91). */
    rotten_tomatoes: { score: number } | null;
    /** Metacritic, 0-100. */
    metacritic: { score: number } | null;
    /** Where these came from, for attribution next to the scores. */
    source: "OMDb";
}

export interface RatingsLookup {
    /** True when OMDb was actually reachable and answered. */
    ok: boolean;
    /**
     * True when OMDb (or TMDB) says this film does not exist there. A definitive
     * answer, so it may be recorded — as opposed to a transient failure.
     */
    missing: boolean;
    ratings: ExternalRatings | null;
}

/** OMDb's `Response` field is a string "True"/"False", not a boolean. */
interface OmdbResponse {
    Response?: string;
    Error?: string;
    imdbID?: string;
    imdbRating?: string;
    imdbVotes?: string;
    Metascore?: string;
    Ratings?: { Source?: string; Value?: string }[];
}

function numberFrom(value: string | undefined): number | null {
    if (!value) return null;
    // OMDb sends "9.3", "2,800,000", "N/A".
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

/** Pull a number out of "91%" or "82/100" (the Ratings array's formats). */
function percentage(value: string | undefined): number | null {
    if (!value) return null;
    const match = /(\d{1,3})\s*(?:%|\/100)?/.exec(value);
    if (!match?.[1]) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Turn an OMDb payload into our shape. Pure, so it can be tested against the real
 * format variants ("N/A", missing sections, a film with only an IMDb score).
 */
export function normalizeOmdb(raw: OmdbResponse): ExternalRatings {
    const imdbScore = numberFrom(raw.imdbRating);
    const bySource = new Map((raw.Ratings ?? []).map((r) => [String(r.Source ?? ""), r.Value]));

    // OMDb reports Metascore both as its own field and inside `Ratings`; prefer the
    // field, and only fall back to the array entry when it is absent.
    const metacritic = numberFrom(raw.Metascore) ?? percentage(bySource.get("Metacritic"));
    const rt = percentage(bySource.get("Rotten Tomatoes"));

    return {
        imdb_id: raw.imdbID ?? null,
        imdb: imdbScore === null ? null : { score: imdbScore, votes: numberFrom(raw.imdbVotes) },
        rotten_tomatoes: rt === null ? null : { score: rt },
        metacritic: metacritic === null ? null : { score: metacritic },
        source: "OMDb",
    };
}

/**
 * Fetch ratings for an IMDb id.
 *
 * Contract matches the rest of the codebase: `ok: false` means *unreachable* (so a
 * caller must not record it as a permanent miss), while `missing: true` means OMDb
 * definitively answered that it has no such title.
 */
export async function getRatingsByImdbId(imdbId: string, attempts = 1): Promise<RatingsLookup> {
    const key = API_KEY();
    if (!key || !imdbId) return { ok: false, missing: false, ratings: null };

    const url = new URL(BASE);
    url.searchParams.set("i", imdbId);
    url.searchParams.set("apikey", key);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
            // 401 means the key is missing/invalid or the daily quota is spent — a
            // configuration problem, not a film that does not exist.
            if (res.status === 401) {
                logger.warn("OMDb rejected the request (invalid key or daily quota reached)");
                return { ok: false, missing: false, ratings: null };
            }
            if (!res.ok) {
                if (attempt < attempts) {
                    await new Promise((r) => setTimeout(r, 400 * attempt));
                    continue;
                }
                return { ok: false, missing: false, ratings: null };
            }
            const body = (await res.json()) as OmdbResponse;
            if (body.Response === "False") {
                // "Movie not found!" is definitive; a quota error is not.
                const definitive = /not found/i.test(body.Error ?? "");
                return { ok: definitive, missing: definitive, ratings: null };
            }
            return { ok: true, missing: false, ratings: normalizeOmdb(body) };
        } catch {
            if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
        }
    }
    return { ok: false, missing: false, ratings: null };
}
