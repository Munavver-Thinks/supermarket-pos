import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEGATIVE_STOCK_POLICY,
  describeShortfalls,
  findStockShortfalls,
  InsufficientStockError,
  parseNegativeStockPolicy,
} from "@/core/business-logic/stockPolicy.js";

describe("parseNegativeStockPolicy", () => {
  it("reads each known policy", () => {
    expect(parseNegativeStockPolicy("allow")).toBe("allow");
    expect(parseNegativeStockPolicy("warn")).toBe("warn");
    expect(parseNegativeStockPolicy("block")).toBe("block");
  });

  it("falls back to warn for missing or unknown values", () => {
    expect(DEFAULT_NEGATIVE_STOCK_POLICY).toBe("warn");
    expect(parseNegativeStockPolicy(undefined)).toBe("warn");
    expect(parseNegativeStockPolicy(null)).toBe("warn");
    // A typo in the stored value must not silently switch a shop to blocking sales.
    expect(parseNegativeStockPolicy("BLOCK")).toBe("warn");
  });
});

describe("findStockShortfalls", () => {
  it("flags a line asking for more than is on hand", () => {
    const shortfalls = findStockShortfalls([{ productId: "p1", name: "Rice", qty: 6 }], { p1: 5 });
    expect(shortfalls).toEqual([{ productId: "p1", name: "Rice", requestedQty: 6, onHandQty: 5 }]);
  });

  it("allows a line that uses exactly what is on hand", () => {
    expect(findStockShortfalls([{ productId: "p1", name: "Rice", qty: 5 }], { p1: 5 })).toEqual([]);
  });

  it("sums the same product across lines before comparing", () => {
    const shortfalls = findStockShortfalls(
      [
        { productId: "p1", name: "Rice", qty: 3 },
        { productId: "p1", name: "Rice", qty: 3 },
      ],
      { p1: 5 },
    );
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]?.requestedQty).toBe(6);
  });

  it("treats a product with no stock row as zero on hand", () => {
    expect(findStockShortfalls([{ productId: "p9", name: "New item", qty: 1 }], {})[0]?.onHandQty).toBe(0);
  });

  it("does not flag weighed quantities over floating-point drift", () => {
    expect(
      findStockShortfalls(
        [
          { productId: "p1", name: "Tomato", qty: 1.1 },
          { productId: "p1", name: "Tomato", qty: 0.2 },
        ],
        { p1: 1.3 },
      ),
    ).toEqual([]);
  });

  it("ignores zero-quantity lines", () => {
    expect(findStockShortfalls([{ productId: "p1", name: "Rice", qty: 0 }], {})).toEqual([]);
  });
});

describe("describeShortfalls", () => {
  it("names every short item and what to do", () => {
    const message = describeShortfalls([
      { productId: "p1", name: "Rice", requestedQty: 6, onHandQty: 5 },
      { productId: "p2", name: "Oil", requestedQty: 2, onHandQty: 0 },
    ]);
    expect(message).toContain("Rice (asked 6, 5 in stock)");
    expect(message).toContain("Oil (asked 2, 0 in stock)");
    expect(message).toMatch(/Inventory/);
  });

  it("carries the shortfalls on the error", () => {
    const error = new InsufficientStockError([{ productId: "p1", name: "Rice", requestedQty: 2, onHandQty: 1 }]);
    expect(error.shortfalls).toHaveLength(1);
    expect(error.message).toMatch(/Not enough stock/);
  });
});
