import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM, EMBEDDING_MODEL, PASSAGE_PREFIX, POOLING, QUERY_PREFIX, withPassagePrefix, withQueryPrefix } from "../src/embedding.js";

/**
 * The embedding configuration is what makes a model swap a measurement instead of
 * a rewrite, so the pieces that can be checked without loading a model are pinned.
 */
describe("embedding configuration", () => {
    it("defaults to the model and 384 dimensions the columns are built for", () => {
        // plot_embedding and keywords_embedding are vector(384): changing the
        // dimension is a schema change and a full re-embed of both columns.
        expect(EMBEDDING_DIM).toBe(384);
        expect(EMBEDDING_MODEL).toContain("all-MiniLM-L6-v2");
    });

    it("defaults to MiniLM's pooling and no prefixes", () => {
        expect(POOLING).toBe("mean");
        expect(QUERY_PREFIX).toBe("");
        expect(PASSAGE_PREFIX).toBe("");
    });

    it("applies a prefix only when one is configured", () => {
        // Empty prefix must be a true no-op, not a leading space.
        expect(withQueryPrefix("a heist")).toBe("a heist");
        expect(withPassagePrefix("a heist")).toBe("a heist");
    });
});
