import { describe, expect, it } from "vitest";
import { keywordList, keywordText, plotText, titleText } from "../src/services/embeddingText.js";

/**
 * The two embedded documents. Kept apart on purpose: blending keywords into the
 * plot document displaced it (measured: 22/43 hits, six queries gained and six
 * lost), so the plot vector must stay exactly what it was and keywords must only
 * ever add a second signal.
 */
const titanic = {
    movie_name: "Titanic",
    release_year: 1997,
    genre: "Drama, Romance",
    keywords: "shipwreck, iceberg, class differences",
    plot: "A young Rose boards the ship with her mother and fiance.",
};

describe("plotText", () => {
    it("is the overview verbatim, punctuation included", () => {
        // Trimming the trailing period changed every vector and measured worse
        // (21/43 vs 22/43), so this is pinned.
        expect(plotText(titanic)).toBe("A young Rose boards the ship with her mother and fiance.");
        expect(plotText({ plot: "  Ends with a full stop.  " })).toBe("Ends with a full stop.");
        expect(plotText({})).toBe("");
    });
});

describe("keywordText", () => {
    it("leads with the title so a named film matches its own row", () => {
        expect(keywordText(titanic)).toBe(
            "Titanic (1997). Drama, Romance. shipwreck, iceberg, class differences",
        );
    });

    it("carries the premise word the overview omits", () => {
        // The whole point: Titanic's overview never says "iceberg".
        expect(plotText(titanic)).not.toContain("iceberg");
        expect(keywordText(titanic)).toContain("iceberg");
    });

    it("omits missing parts without stray separators", () => {
        expect(keywordText({ movie_name: "Primer" })).toBe("Primer");
        expect(keywordText({ movie_name: "Primer", release_year: 2004 })).toBe("Primer (2004)");
    });

    it("handles empty input without throwing", () => {
        expect(keywordText({})).toBe("");
        expect(titleText({ movie_name: "  X  " })).toBe("X");
    });
});

describe("keywordList", () => {
    it("caps the list, keeping the most relevant terms", () => {
        const many = Array.from({ length: 25 }, (_, i) => `kw${i + 1}`).join(", ");
        expect(keywordList(many)).toContain("kw10");
        expect(keywordList(many)).not.toContain("kw11");
    });

    it("tolerates empty and messy input", () => {
        expect(keywordList(undefined)).toBe("");
        expect(keywordList(" a ,, b ,")).toBe("a, b");
    });
});
