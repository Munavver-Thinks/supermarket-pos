import { describe, expect, it } from "vitest";

import { normalizeSearchText, rankProducts, type SearchableCandidate } from "./searchEngine.js";

function candidate(overrides: Partial<SearchableCandidate>): SearchableCandidate {
  return {
    productId: "p1",
    name: "Aachi Chilli Powder 200g",
    nameTamil: null,
    shortCode: null,
    uom: "pcs",
    isWeighted: 0,
    taxRatePercent: 5,
    barcode: null,
    matchedAlias: null,
    salePricePaise: 4500,
    mrpPaise: 5000,
    wholesalePricePaise: null,
    isTaxInclusive: 1,
    stockOnHand: 10,
    ...overrides,
  };
}

describe("normalizeSearchText", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeSearchText("  Aachi   Milagai  ")).toBe("aachi milagai");
  });

  it("strips punctuation", () => {
    expect(normalizeSearchText("Aachi, Chilli-Powder!")).toBe("aachi chillipowder");
  });
});

describe("rankProducts", () => {
  it("ranks an exact alias match above an exact name match", () => {
    const results = rankProducts("aachi milagai", [
      candidate({ productId: "p1", name: "Something else entirely", matchedAlias: "aachi milagai" }),
      candidate({ productId: "p2", name: "aachi milagai" }),
    ]);
    expect(results[0]?.productId).toBe("p1");
    expect(results[0]?.matchType).toBe("alias_exact");
  });

  it("ranks a prefix match below an exact match", () => {
    const results = rankProducts("aachi", [
      candidate({ productId: "p1", name: "Aachi Chilli Powder 200g" }),
      candidate({ productId: "p2", name: "aachi", matchedAlias: "aachi" }),
    ]);
    expect(results[0]?.productId).toBe("p2");
    expect(results[1]?.matchType).toBe("prefix");
  });

  it("deduplicates a product matched by multiple aliases, keeping the best score", () => {
    const results = rankProducts("milagai", [
      candidate({ productId: "p1", name: "Aachi Chilli Powder", matchedAlias: "milagai podi" }),
      candidate({ productId: "p1", name: "Aachi Chilli Powder", matchedAlias: "milagai" }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.matchType).toBe("alias_exact");
  });

  it("returns an empty array for a blank query", () => {
    expect(rankProducts("   ", [candidate({})])).toEqual([]);
  });
});
