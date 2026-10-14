import { describe, expect, it } from "vitest";

import { computePurchaseTotals, unitCostFromLine } from "./purchaseEngine.js";

describe("computePurchaseTotals", () => {
  it("adds GST on top for a tax-exclusive supplier invoice (the common case)", () => {
    // 10 units at ₹100 exclusive, 5% GST => 1000 taxable, 50 tax, 1050 total
    const { lines, totals } = computePurchaseTotals([
      { productId: "p1", qty: 10, costPricePaise: 10000, taxRatePercent: 5, isTaxInclusive: false },
    ]);

    expect(lines[0]?.taxablePaise).toBe(100000);
    expect(lines[0]?.taxPaise).toBe(5000);
    expect(lines[0]?.lineTotalPaise).toBe(105000);
    expect(totals).toEqual({ subtotalPaise: 100000, taxPaise: 5000, totalPaise: 105000 });
  });

  it("divides GST back out of a tax-inclusive supplier invoice", () => {
    // 1 unit at ₹118 inclusive, 18% GST => 100 taxable, 18 tax
    const { lines, totals } = computePurchaseTotals([
      { productId: "p1", qty: 1, costPricePaise: 11800, taxRatePercent: 18, isTaxInclusive: true },
    ]);

    expect(lines[0]?.taxablePaise).toBe(10000);
    expect(lines[0]?.taxPaise).toBe(1800);
    expect(lines[0]?.lineTotalPaise).toBe(11800);
    expect(totals.totalPaise).toBe(11800);
  });

  it("sums mixed-rate lines into one invoice total", () => {
    const { totals } = computePurchaseTotals([
      { productId: "p1", qty: 2, costPricePaise: 5000, taxRatePercent: 0, isTaxInclusive: false },
      { productId: "p2", qty: 1, costPricePaise: 20000, taxRatePercent: 5, isTaxInclusive: false },
    ]);

    expect(totals.subtotalPaise).toBe(30000);
    expect(totals.taxPaise).toBe(1000);
    expect(totals.totalPaise).toBe(31000);
  });

  it("handles a zero-rated line without inventing tax", () => {
    const { lines } = computePurchaseTotals([
      { productId: "p1", qty: 3, costPricePaise: 6200, taxRatePercent: 0, isTaxInclusive: true },
    ]);

    expect(lines[0]?.taxablePaise).toBe(18600);
    expect(lines[0]?.taxPaise).toBe(0);
  });

  it("totals an empty invoice as zero rather than NaN", () => {
    const { lines, totals } = computePurchaseTotals([]);

    expect(lines).toEqual([]);
    expect(totals).toEqual({ subtotalPaise: 0, taxPaise: 0, totalPaise: 0 });
  });

  it("supports fractional quantities for weighted goods", () => {
    // 2.5 kg at ₹62/kg exclusive, 0% GST
    const { totals } = computePurchaseTotals([
      { productId: "p1", qty: 2.5, costPricePaise: 6200, taxRatePercent: 0, isTaxInclusive: false },
    ]);

    expect(totals.totalPaise).toBe(15500);
  });
});

describe("unitCostFromLine", () => {
  it("returns the tax-exclusive per-unit cost", () => {
    const { lines } = computePurchaseTotals([
      { productId: "p1", qty: 10, costPricePaise: 11800, taxRatePercent: 18, isTaxInclusive: true },
    ]);

    // ₹118 inclusive per unit at 18% => ₹100 exclusive per unit
    expect(unitCostFromLine(lines[0]!)).toBe(10000);
  });

  it("does not divide by zero on a zero-qty line", () => {
    expect(
      unitCostFromLine({
        productId: "p1",
        qty: 0,
        costPricePaise: 1000,
        taxRatePercent: 0,
        taxablePaise: 0,
        taxPaise: 0,
        lineTotalPaise: 0,
      }),
    ).toBe(0);
  });
});
