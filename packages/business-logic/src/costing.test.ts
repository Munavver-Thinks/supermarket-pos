import { describe, expect, it } from "vitest";

import { findMarginWarnings, marginConfirmText, purchaseMarginConfirmText, weightedAverageCost } from "./costing.js";

describe("weightedAverageCost", () => {
  it("takes the received cost when there's no stock on hand", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: 0, currentCostPaise: 4000, qtyReceived: 10, receivedTaxablePaise: 50000 }),
    ).toBe(5000);
  });

  it("takes the received cost when on-hand is negative (oversold)", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: -5, currentCostPaise: 4000, qtyReceived: 10, receivedTaxablePaise: 50000 }),
    ).toBe(5000);
  });

  it("takes the received cost when there's no current cost recorded", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: 10, currentCostPaise: 0, qtyReceived: 10, receivedTaxablePaise: 50000 }),
    ).toBe(5000);
  });

  it("blends on-hand and received stock: 10 @ ₹40 + 10 @ ₹50 = ₹45", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: 10, currentCostPaise: 4000, qtyReceived: 10, receivedTaxablePaise: 50000 }),
    ).toBe(4500);
  });

  it("handles fractional (weighed-goods) quantities", () => {
    // 2.5kg @ ₹40 on hand + 2.5kg received for ₹125 (₹50/kg) = ₹45/kg.
    expect(
      weightedAverageCost({ qtyOnHandBefore: 2.5, currentCostPaise: 4000, qtyReceived: 2.5, receivedTaxablePaise: 12500 }),
    ).toBe(4500);
  });

  it("leaves cost unchanged when the line has zero or negative qty", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: 10, currentCostPaise: 4000, qtyReceived: 0, receivedTaxablePaise: 0 }),
    ).toBe(4000);
    expect(
      weightedAverageCost({ qtyOnHandBefore: 10, currentCostPaise: 4000, qtyReceived: -1, receivedTaxablePaise: 100 }),
    ).toBe(4000);
  });

  it("leaves cost unchanged when the line's taxable value is zero", () => {
    expect(
      weightedAverageCost({ qtyOnHandBefore: 10, currentCostPaise: 4000, qtyReceived: 10, receivedTaxablePaise: 0 }),
    ).toBe(4000);
  });
});

describe("findMarginWarnings", () => {
  const base = { costPricePaise: 5000, salePricePaise: 10000, wholesalePricePaise: null, taxRatePercent: 0, isTaxInclusive: false };

  it("warns nothing when there's healthy margin", () => {
    expect(findMarginWarnings(base)).toEqual([]);
  });

  it("warns when cost equals sale price (equal counts as no profit)", () => {
    const warnings = findMarginWarnings({ ...base, costPricePaise: 10000 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("sale");
    expect(warnings[0]?.message).toContain("No profit");
  });

  it("warns on GST-inclusive price once GST is taken out", () => {
    // ₹50 incl. 5% GST ≈ ₹47.62 ex-tax; a ₹48 cost is >= that, so it must warn.
    const warnings = findMarginWarnings({
      costPricePaise: 4800,
      salePricePaise: 5000,
      wholesalePricePaise: null,
      taxRatePercent: 5,
      isTaxInclusive: true,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.priceExTaxPaise).toBe(4762);
    expect(warnings[0]?.message).toContain("incl. GST");
  });

  it("never warns when cost is 0 (no cost recorded)", () => {
    expect(findMarginWarnings({ ...base, costPricePaise: 0, salePricePaise: 0, wholesalePricePaise: 0 })).toEqual([]);
  });

  it("does not warn about wholesale when none is set", () => {
    const warnings = findMarginWarnings({ ...base, costPricePaise: 10000, wholesalePricePaise: null });
    expect(warnings.some((w) => w.kind === "wholesale")).toBe(false);
  });

  it("warns separately on wholesale when it's also at or below cost", () => {
    const warnings = findMarginWarnings({ ...base, costPricePaise: 10000, wholesalePricePaise: 9000 });
    expect(warnings.map((w) => w.kind)).toEqual(["sale", "wholesale"]);
  });
});

describe("marginConfirmText", () => {
  it("joins warning lines under the product name", () => {
    const text = marginConfirmText("Toor Dal", [
      { kind: "sale", costPricePaise: 100, pricePaise: 100, priceExTaxPaise: 100, message: "line one" },
      { kind: "wholesale", costPricePaise: 100, pricePaise: 90, priceExTaxPaise: 90, message: "line two" },
    ]);
    expect(text).toBe("Toor Dal: line one\nline two\n\nSave these prices anyway?");
  });
});

describe("purchaseMarginConfirmText", () => {
  it("lists every warning row with cost and sale price", () => {
    const text = purchaseMarginConfirmText([{ name: "Toor Dal", costPricePaise: 10000, salePricePaise: 9000 }]);
    expect(text).toContain("These items cost as much as or more than they sell for:");
    expect(text).toContain("• Toor Dal — cost ₹100.00, sells at ₹90.00");
    expect(text).toContain("Receive anyway?");
  });
});
