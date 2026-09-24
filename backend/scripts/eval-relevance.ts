/**
 * Score describe-the-plot search against a fixed query set.
 *
 *   npm run eval:relevance              # every query, semantic mode
 *   npm run eval:relevance -- --mode hybrid
 *   npm run eval:relevance -- --verbose   # show the top 5 for each query
 *
 * Reports hits@10 (did any expected film appear in the top ten) and MRR (how
 * high the first expected film ranked), plus the top-1 for every miss so the
 * failures are readable rather than just counted.
 *
 * This is deliberately a script and not a vitest suite: it needs the real
 * catalogue and the real embedding model, while the unit tests must stay
 * hermetic and fast. Run it against a database that has embeddings before
 * changing anything about ranking or retrieval, and again afterwards — the whole
 * point is that relevance claims get numbers attached.
 */
import { getPool, closePool } from "../src/db/pool.js";
import { generateEmbedding } from "../src/embedding.js";
import { semanticService } from "../src/services/semantic.js";
import { parseSearchQuery } from "../src/agent/queryParser.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { RELEVANCE_QUERIES } from "./relevance-queries.js";
import type { ExpectedFilm } from "./relevance-queries.js";

const TOP_N = 10;

/**
 * `/search/semantic` does not embed what the user typed: it runs the query
 * through the LLM parser first and embeds the *interpreted* query. So there are
 * two things to measure, and they can move independently — a rewrite can rescue
 * a query or ruin one ("gruesome murders in a rainy city" became something that
 * no longer retrieved Se7en at all).
 *
 * `--via-agent` mirrors the route: rewrite, then embed the rewrite. Rewrites are
 * cached to disk so two runs at different weights rank the *same* text, which is
 * the only way the comparison means anything (and it keeps the LLM bill to one
 * pass).
 */
const VIA_AGENT = process.argv.includes("--via-agent");
const REWRITE_CACHE = "/tmp/flickfindr-agent-rewrites.json";

async function effectiveQuery(raw: string): Promise<string> {
    if (!VIA_AGENT) return raw;
    let cache: Record<string, string> = {};
    if (existsSync(REWRITE_CACHE)) {
        try {
            cache = JSON.parse(readFileSync(REWRITE_CACHE, "utf8"));
        } catch {
            cache = {};
        }
    }
    if (!(raw in cache)) {
        const interpreted = await parseSearchQuery(raw);
        // Same rule as the route: an empty rewrite falls back to what was typed.
        cache[raw] = interpreted.query?.trim() ? interpreted.query : raw;
        writeFileSync(REWRITE_CACHE, JSON.stringify(cache, null, 2));
    }
    return cache[raw] ?? raw;
}

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const MODE = arg("mode") ?? "semantic";
const VERBOSE = process.argv.includes("--verbose");

interface Outcome {
    query: string;
    /** What was actually embedded — the LLM rewrite in agent mode. */
    embedded: string;
    hit: boolean;
    rank: number | null; // 1-based rank of the first expected film
    top1: string;
    top1Votes: number;
    votes: number[]; // votes of the returned films, for the diversity diagnostic
    missing: string[];
}

/** "Twilight" is not one film in this catalogue — three share the name. */
function matches(movie: { movie_name?: unknown; release_year?: unknown }, want: ExpectedFilm): boolean {
    if (String(movie.movie_name ?? "").toLowerCase() !== want.title.toLowerCase()) return false;
    if (want.year === undefined) return true;
    return Number(movie.release_year) === want.year;
}

const label = (want: ExpectedFilm) => (want.year ? `${want.title} (${want.year})` : want.title);

/** Expectations that resolve to no film — fixture rot, reported loudly. */
async function unresolvable(): Promise<string[]> {
    const { rows } = await getPool().query("SELECT movie_name, release_year FROM movies");
    return RELEVANCE_QUERIES.flatMap((c) => c.expect)
        .filter((want) => !rows.some((r) => matches(r, want)))
        .map(label);
}

async function runQuery(c: { query: string; expect: ExpectedFilm[] }): Promise<Outcome> {
    const embedded = await effectiveQuery(c.query);
    const embedding = await generateEmbedding(embedded);
    const result =
        MODE === "hybrid"
            ? await semanticService.hybridSearch(getPool(), { query: embedded, limit: TOP_N }, async () => embedding)
            : await semanticService.semanticSearch(getPool(), { query: embedded, limit: TOP_N, skip: 0 }, async () => embedding);
    const rows = result.movies;
    const rank = rows.findIndex((m) => c.expect.some((want) => matches(m, want)));
    const voteOf = (m: { votes?: unknown }) => Number(String(m.votes ?? "0").replace(/\D/g, "")) || 0;
    return {
        query: c.query,
        embedded,
        hit: rank >= 0,
        rank: rank >= 0 ? rank + 1 : null,
        top1: rows[0]?.movie_name ?? "(no results)",
        top1Votes: rows[0] ? voteOf(rows[0]) : 0,
        votes: rows.map(voteOf),
        missing: c.expect.filter((want) => !rows.some((m) => matches(m, want))).map(label),
    };
}

async function main(): Promise<void> {
    const broken = await unresolvable();
    if (broken.length) {
        console.log(`\n⚠ ${broken.length} expected title(s) match no film in this database:`);
        for (const t of broken) console.log(`   - ${t}`);
        console.log("  Fix the fixture (or the database) before trusting the score.\n");
    }

    console.log(
        `\nEvaluating ${RELEVANCE_QUERIES.length} queries in ${MODE} mode${VIA_AGENT ? " via the LLM rewrite" : " on the raw query"}, top ${TOP_N}\n`,
    );
    const outcomes: Outcome[] = [];
    for (const c of RELEVANCE_QUERIES) {
        const o = await runQuery(c);
        outcomes.push(o);
        const mark = o.hit ? `✓ rank ${o.rank}` : "✗";
        console.log(`  ${mark.padEnd(9)} ${c.query.slice(0, 62)}`);
        if (VERBOSE && VIA_AGENT && o.embedded !== c.query) {
            console.log(`            embedded: ${o.embedded.slice(0, 100)}`);
        }
        if (VERBOSE || !o.hit) {
            console.log(`            top1: ${o.top1}`);
            if (o.missing.length) console.log(`            missed: ${o.missing.join(", ")}`);
        }
    }

    const hits = outcomes.filter((o) => o.hit).length;
    const mrr = outcomes.reduce((sum, o) => sum + (o.rank ? 1 / o.rank : 0), 0) / outcomes.length;

    // The blockbuster-heavy fixture flatters a popularity prior: raising the
    // weight keeps "hits" climbing even when the ranker has stopped reading the
    // query at all. These two diagnostics are the guard. If every query returns
    // the same handful of famous films, distinct collapses and meanVotes soars.
    const distinct = new Set<string>();
    for (const o of outcomes) distinct.add(o.top1);
    const meanTop1Votes = Math.round(outcomes.reduce((s, o) => s + o.top1Votes, 0) / outcomes.length);
    const allVotes = outcomes.flatMap((o) => o.votes);
    const meanVotes = Math.round(allVotes.reduce((s, v) => s + v, 0) / Math.max(allVotes.length, 1));

    console.log(`\n${"=".repeat(64)}`);
    console.log(`  hits@${TOP_N}: ${hits}/${outcomes.length}  (${((hits / outcomes.length) * 100).toFixed(1)}%)`);
    console.log(`  MRR:      ${mrr.toFixed(4)}`);
    console.log(`  distinct top-1 films: ${distinct.size}/${outcomes.length}`);
    console.log(`  mean votes — top-1: ${meanTop1Votes.toLocaleString()}, all returned: ${meanVotes.toLocaleString()}`);
    console.log(`${"=".repeat(64)}\n`);

    if (process.argv.includes("--json")) {
        // Single line on purpose: this output is piped and diffed when comparing
        // two weights, and pretty-printing makes it awkward to extract.
        console.log(JSON.stringify({ mode: MODE, viaAgent: VIA_AGENT, hits, total: outcomes.length, mrr, outcomes }));
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => closePool());
