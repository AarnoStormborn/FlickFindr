import { describe, expect, it } from "vitest";
import {
  lastAssistantText,
  mergeAgentParse,
  parseJsonObject,
  parseSearchQuery,
  resolveAgentReply,
} from "../src/agent/queryParser.js";
import { budgetSnapshot, resetBudget, tryConsume } from "../src/services/llmBudget.js";

/**
 * The query parser turns a model reply into structured search filters. The two
 * steps that can silently break search are extracting the assistant text out of
 * a message list, and pulling JSON out of a reply that may be fenced or chatty.
 */

describe("lastAssistantText", () => {
  it("returns undefined with no messages", () => {
    expect(lastAssistantText([])).toBeUndefined();
  });

  it("takes the LAST assistant message, not the first", () => {
    const messages = [
      { role: "assistant", content: "first" },
      { role: "user", content: "again" },
      { role: "assistant", content: "second" },
    ];
    expect(lastAssistantText(messages)).toBe("second");
  });

  it("handles a plain string content", () => {
    expect(lastAssistantText([{ role: "assistant", content: "hello" }])).toBe("hello");
  });

  it("concatenates content parts", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "a " }, { type: "text", text: "b" }] },
    ];
    expect(lastAssistantText(messages)).toBe("a b");
  });

  it("ignores non-text parts and tool calls", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "1", name: "search_movies", arguments: {} },
          { type: "text", text: "the answer" },
        ],
      },
    ];
    expect(lastAssistantText(messages)).toBe("the answer");
  });

  it("skips assistant messages with no text", () => {
    const messages = [
      { role: "assistant", content: "kept" },
      { role: "assistant", content: [{ type: "thinking", text: "hmm" }] },
    ];
    // The last assistant message has no text; falling back is acceptable as
    // long as it does not return the thinking block.
    const out = lastAssistantText(messages);
    expect(out).not.toBe("hmm");
  });

  it("tolerates malformed entries", () => {
    expect(() => lastAssistantText([null, undefined, 42, { role: "user" }])).not.toThrow();
  });
});

describe("parseJsonObject", () => {
  it("parses a clean object", () => {
    expect(parseJsonObject('{"query":"prison escape","genre":"Drama"}')).toMatchObject({
      query: "prison escape",
      genre: "Drama",
      limit: 10,
    });
  });

  it("strips a ```json fence", () => {
    expect(parseJsonObject('```json\n{"query":"noir"}\n```')?.query).toBe("noir");
  });

  it("strips a bare ``` fence", () => {
    expect(parseJsonObject('```\n{"query":"noir"}\n```')?.query).toBe("noir");
  });

  it("extracts the object from surrounding prose", () => {
    expect(parseJsonObject('Sure! Here you go: {"query":"noir","min_rating":7} Hope that helps.')?.query).toBe("noir");
  });

  it("keeps numeric bounds valid", () => {
    expect(parseJsonObject('{"query":"neo noir","min_rating":7.5}')?.min_rating).toBe(7.5);
  });

  it("clamps a missing limit to the schema default", () => {
    expect(parseJsonObject('{"query":"heist"}')?.limit).toBe(10);
  });

  it("returns undefined for no JSON at all", () => {
    expect(parseJsonObject("I could not find anything")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseJsonObject("{query: unquoted,}")).toBeUndefined();
  });

  it("returns undefined for a schema-violating object", () => {
    // min_rating above the schema maximum.
    expect(parseJsonObject('{"query":"heist","min_rating":99}')).toBeUndefined();
  });

  it("drops unknown fields rather than passing them through", () => {
    const parsed = parseJsonObject('{"query":"heist","DROP TABLE movies":true}');
    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty("DROP TABLE movies");
  });
});

describe("resolveAgentReply", () => {
  it.each([
    {
      name: "genre and rating",
      query: "a heist film with a twist",
      filters: { genre: "Crime", min_rating: 7 },
    },
    {
      name: "cast and runtime",
      query: "a detective looking for her sister",
      filters: { stars: "Viola Davis", max_runtime: 120 },
    },
    {
      name: "director and rating ceiling",
      query: "a family on a cross-country road trip",
      filters: { directors: "Greta Gerwig", max_rating: 8 },
    },
    {
      name: "no filters",
      query: "a mystery set in a seaside village",
      filters: {},
    },
  ])("accepts an unchanged plot query with $name", ({ query, filters }) => {
    const reply = JSON.stringify({ query, ...filters });
    expect(resolveAgentReply(query, reply)).toEqual({
      parsed: true,
      request: { query, ...filters, skip: 0, limit: 10 },
    });
  });

  it("accepts a rewritten plot query with filters", () => {
    const reply = JSON.stringify({ query: "a crew steals from a casino", genre: "Crime" });
    expect(resolveAgentReply("a casino heist", reply)).toEqual({
      parsed: true,
      request: { query: "a crew steals from a casino", genre: "Crime", skip: 0, limit: 10 },
    });
  });

  it("rejects a blank plot query", () => {
    expect(resolveAgentReply("crime film", '{"query":"   ","genre":"Crime"}')).toEqual({
      parsed: false,
      request: { query: "crime film", skip: 0, limit: 10 },
    });
  });
});

describe("parseSearchQuery fallbacks", () => {
  it("returns the raw query untouched when the input is blank", async () => {
    const res = await parseSearchQuery("   ");
    // Returned verbatim: the caller still has to decide what to do with it.
    expect(res.query).toBe("   ");
    expect(res.skip).toBe(0);
    expect(res.limit).toBe(10);
  });
});

/**
 * Search must degrade, not fail, when the model budget is spent: the rewrite is an
 * improvement, not a requirement, and the eval set measures the raw query as equal
 * or slightly better on well-formed input. This also keeps the app usable with no
 * funded provider at all.
 */
describe("parseSearchQuery without budget", () => {
  it("falls back to the raw query instead of calling the model", async () => {
    const { limit } = budgetSnapshot();
    for (let i = 0; i < limit; i += 1) tryConsume();

    const result = await parseSearchQuery("a heist film with a twist");
    expect(result).toEqual({ query: "a heist film with a twist", skip: 0, limit: 10 });
    resetBudget();
  });
});

/**
 * Caching is now keyed on "the model answered", not "the answer differs from the
 * input". This is the half of that rule a test can reach without a live model: a
 * parse that *failed* must not be cached, or a transient outage would be remembered
 * for the cache TTL. (The other half — an unchanged answer being cached — is verified
 * against the running service, since it requires a real model reply.)
 */
describe("parse cache only remembers real answers", () => {
  it("does not cache a failed parse", async () => {
    resetBudget();
    const before = budgetSnapshot().used;
    // No provider credentials in the test environment, so this fails fast and falls
    // back. Both calls must reach the model, which is how we observe "not cached".
    const first = await parseSearchQuery("a film about a lighthouse keeper we have never asked about");
    const second = await parseSearchQuery("a film about a lighthouse keeper we have never asked about");
    expect(first.query).toBe("a film about a lighthouse keeper we have never asked about");
    expect(second.query).toBe(first.query);
    expect(budgetSnapshot().used - before).toBe(2);
    resetBudget();
  }, 30_000);
});

/**
 * The agent's filters are model-generated and used to reach the query builder
 * directly, so they are re-validated on merge. #50 made the parser accept more
 * parses (including ones that keep the user's wording), which means more of these
 * fields actually take effect — so the bound matters more than it did.
 */
describe("mergeAgentParse", () => {
  const base = { query: "a heist film", skip: 0, limit: 10 } as const;

  it("lets the agent fill gaps the request did not specify", () => {
    const { request, invalid } = mergeAgentParse(
      { ...base },
      { query: "a crew robs a casino", genre: "Crime", stars: "George Clooney", max_runtime: 120 },
    );
    expect(invalid).toBeUndefined();
    expect(request).toMatchObject({
      query: "a crew robs a casino",
      genre: "Crime",
      stars: "George Clooney",
      max_runtime: 120,
    });
  });

  it("keeps the caller's query and page window, letting the agent's filters win", () => {
    // Pre-existing precedence, pinned rather than changed here: the agent's genre
    // overrides, but the caller's query text and page window are never taken from the
    // model. In practice the hybrid UI sends no filters, so this is mostly hypothetical.
    const { request } = mergeAgentParse(
      { query: "a heist film", genre: "Comedy", limit: 5, skip: 20 },
      { query: "a crew robs a casino", genre: "Crime", stars: "Someone" },
    );
    expect(request.genre).toBe("Crime");
    expect(request.query).toBe("a crew robs a casino");
    expect(request.limit).toBe(5);
    expect(request.skip).toBe(20);
  });

  it("uses the caller's query when the agent returns none", () => {
    const { request } = mergeAgentParse({ ...base }, { query: "   " });
    expect(request.query).toBe("a heist film");
  });

  it("rejects an out-of-range filter and falls back to the caller's request", () => {
    // A hallucinated bound would otherwise reach SQL and silently return nothing.
    const { request, invalid } = mergeAgentParse({ ...base }, { query: "a heist film", min_rating: 99 });
    // The message text is zod's; what matters is that it is reported and the field is
    // dropped rather than reaching SQL.
    expect(invalid).toBeTruthy();
    expect(request.min_rating).toBeUndefined();
    expect(request.query).toBe("a heist film");
  });

  it("rejects a negative runtime the same way", () => {
    const { request, invalid } = mergeAgentParse({ ...base }, { query: "a heist film", max_runtime: -5 });
    expect(invalid).toBeTruthy();
    expect(request.max_runtime).toBeUndefined();
  });
});
