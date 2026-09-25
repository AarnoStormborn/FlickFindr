/**
 * The texts that get embedded, in one place.
 *
 * Two documents, two columns, two cosine scores combined at query time:
 *
 *   plot_embedding      the film's own overview — what it is about
 *   keywords_embedding  title + year + genres + TMDB keywords — what it is called
 *                       and what vocabulary describes it
 *
 * They are kept apart deliberately, and that is the second attempt. The first was
 * a single richer document (`title. genres. keywords. plot`), measured at 22/43
 * hits against the plot-only baseline's 22/43 — a wash with six queries gained
 * and six lost. Two follow-ups explained why:
 *
 *   - Keywords leading, uncapped, dominated the mean-pooled vector. Films carry up
 *     to 28 TMDB keywords (The Sixth Sense: 400 characters of keywords against a
 *     137-character plot), so the vector stopped being about the film's story.
 *   - Moving the plot first and capping keywords was worse still (18/43): the
 *     keyword signal was then too diluted to help, while still perturbing the
 *     plot vector.
 *
 * Splitting them means the plot vector stays exactly what it was, so plot-driven
 * queries cannot regress, and the keyword vector only ever adds. The two scores
 * are combined with a tunable weight (SEMANTIC_KEYWORD_WEIGHT) and swept against
 * `npm run eval:relevance`, the same way the prominence prior is.
 *
 * Why keywords at all: TMDB's overview is a spoiler-free marketing blurb. Two
 * measured examples of what that costs —
 *
 *   The Sixth Sense  "meets a nine year old boy… who is hiding a dark secret"
 *                                            — never says he sees dead people
 *   Titanic          "...through to its death—on its first and last voyage"
 *                                            — never says "iceberg"
 *
 * so no model or ranking could retrieve them for the queries that describe them.
 * The keywords do contain those words ("iceberg" is in Titanic's list).
 */
export interface EmbeddableMovie {
    movie_name?: unknown;
    release_year?: unknown;
    genre?: unknown;
    keywords?: unknown;
    plot?: unknown;
}

/** Separator between parts; a period reads as prose to the tokenizer. */
const PART_SEPARATOR = ". ";

/**
 * Keywords are capped: a 28-term list adds noise as readily as signal, and the
 * list is ordered by TMDB's own relevance, so the first ten carry the topic.
 */
const MAX_KEYWORDS = 10;

/** Trim trailing punctuation so joining parts cannot produce "fiance..". */
function clean(part: string): string {
    return part.replace(/[\s.]+$/, "");
}

function join(parts: unknown[]): string {
    return parts
        .map((p) => clean(String(p ?? "").trim()))
        .filter(Boolean)
        .join(PART_SEPARATOR);
}

/** `Title (Year)` — the film's name, which many queries actually use. */
export function titleText(movie: EmbeddableMovie): string {
    const name = String(movie.movie_name ?? "").trim();
    if (!name) return "";
    const year = movie.release_year === null || movie.release_year === undefined ? "" : String(movie.release_year);
    return clean(year ? `${name} (${year})` : name);
}

/** The first `MAX_KEYWORDS` TMDB keyword names. */
export function keywordList(raw: unknown): string {
    return String(raw ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, MAX_KEYWORDS)
        .join(", ");
}

/**
 * What the film is about. Deliberately the overview *verbatim* — trailing
 * punctuation and all.
 *
 * A trim was tried and reverted: it changed every plot vector, and measured
 * 21/43 (MRR 0.235) where the untrimmed text scored 22/43 (MRR 0.301). Retrieval
 * here is brittle enough that a punctuation tidy-up is a regression, so this
 * function exists to be stable, not tidy.
 */
export function plotText(movie: EmbeddableMovie): string {
    return String(movie.plot ?? "").trim();
}

/** What the film is called and what vocabulary describes it. */
export function keywordText(movie: EmbeddableMovie): string {
    // Title first: a query that names the film should match its own row hardest,
    // and this vector is the only place the title appears.
    return join([titleText(movie), movie.genre, keywordList(movie.keywords)]);
}
