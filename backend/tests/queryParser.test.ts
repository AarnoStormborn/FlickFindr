import { describe, expect, it } from "vitest";
import { lastAssistantText, parseJsonObject, parseSearchQuery } from "../src/agent/queryParser.js";

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

describe("parseSearchQuery fallbacks", () => {
  it("returns the raw query untouched when the input is blank", async () => {
    const res = await parseSearchQuery("   ");
    // Returned verbatim: the caller still has to decide what to do with it.
    expect(res.query).toBe("   ");
    expect(res.skip).toBe(0);
    expect(res.limit).toBe(10);
  });
});
