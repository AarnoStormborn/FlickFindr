import { describe, expect, it } from "vitest";
import { chooseModel } from "../src/agent/runtime.js";

/**
 * Guards the model-selection policy. The bug this exists for: omitting an
 * explicit model makes the SDK pick the *first* authenticated model, and a
 * provider catalog mixes free models with $50/M flagships — so the agent could
 * silently run on the most expensive option available.
 */
const model = (provider: string, id: string, input = 0, output = 0) => ({
  provider,
  id,
  cost: { input, output },
});

const FREE = model("commandcode", "poolside/laguna-s-2.1-free");
const FLASH = model("commandcode", "deepseek/deepseek-v4-flash", 0.3, 1.2);
const OPUS = model("anthropic", "claude-opus-5", 5, 25);

describe("chooseModel", () => {
  it("returns undefined when nothing is authenticated", () => {
    expect(chooseModel([], ["commandcode/poolside/laguna-s-2.1-free"])).toBeUndefined();
  });

  it("prefers PI_MODEL (first preference) over later fallbacks", () => {
    const chosen = chooseModel([FREE, FLASH], [
      "commandcode/deepseek/deepseek-v4-flash",
      "commandcode/poolside/laguna-s-2.1-free",
    ]);
    expect(chosen).toBe(FLASH);
  });

  it("falls through the preference list to the first available model", () => {
    // First two preferences are not authenticated; third is.
    const chosen = chooseModel([FLASH], [
      "commandcode/poolside/laguna-s-2.1-free",
      "commandcode/xiaomi/mimo-v2.5",
      "commandcode/deepseek/deepseek-v4-flash",
    ]);
    expect(chosen).toBe(FLASH);
  });

  it("matches provider/id exactly, preferring it over a loose substring hit", () => {
    const exact = model("commandcode", "Qwen/Qwen3.8-Flash", 0.16, 0.47);
    const loose = model("commandcode", "Qwen/Qwen3.8-Flash-Preview", 1, 1);
    expect(chooseModel([loose, exact], ["commandcode/Qwen/Qwen3.8-Flash"])).toBe(exact);
  });

  it("accepts a bare substring preference", () => {
    expect(chooseModel([FREE, FLASH], ["laguna"])).toBe(FREE);
  });

  it("uses the cheapest model when no preference matches — never the priciest", () => {
    expect(chooseModel([OPUS, FREE, FLASH], ["something/not-there"])).toBe(FREE);
  });

  it("picks the cheapest among paid models when no free model is available", () => {
    expect(chooseModel([OPUS, FLASH], ["nope/nope"])).toBe(FLASH);
  });

  it("is deterministic for equal costs (alphabetical tie-break)", () => {
    const a = model("zprovider", "b-model", 1, 1);
    const b = model("aprovider", "a-model", 1, 1);
    expect(chooseModel([a, b], [])).toBe(b);
  });

  it("ignores blank preferences", () => {
    expect(chooseModel([FREE], ["", "   "])).toBe(FREE);
  });
});
