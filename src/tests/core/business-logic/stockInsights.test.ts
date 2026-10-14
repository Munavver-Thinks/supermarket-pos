import { describe, expect, it } from "vitest";

import { buildMarginRows, daysOfCover, exTaxPricePaise, marginPercent } from "@/core/business-logic/stockInsights.js";

describe("marginPercent", () => {
  it("is profit over revenue, to one decimal", () => {
    expect(marginPercent(15000, 7000)).toBe(53.3);
    expect(marginPercent(10000, 12000)).toBe(-20);
  });

  it("is null when nothing was taken", () => {
    expect(marginPercent(0, 500)).toBeNull();
    expect(marginPercent(-100, 0)).toBeNull();
  });
});

describe("daysOfCover", () => {
  it("divides stock by the daily rate", () => {
    // 30 sold in 30 days = 1 a day; 90 on hand lasts 90 days.
    expect(daysOfCover(90, 30, 30)).toBe(90);
    expect(daysOfCover(10, 3, 30)).toBe(100);
  });

  it("has no answer when nothing sold", () => {
    expect(daysOfCover(10, 0, 30)).toBeNull();
  });
});

describe("exTaxPricePaise", () => {
  it("takes GST out of an inclusive price, as the bill would", () => {
    expect(exTaxPricePaise(10500, 5, true)).toBe(10000);
    expect(exTaxPricePaise(10000, 5, false)).toBe(10000);
    expect(exTaxPricePaise(15000, 0, true)).toBe(15000);
  });
});

describe("buildMarginRows", () => {
  const base = { uom: "pcs", taxRatePercent: 0, isTaxInclusive: true };

  it("flags below-cost and missing-cost products, worst margin first", () => {
    const rows = buildMarginRows([
      { ...base, productId: "a", name: "Rice", salePricePaise: 6000, costPricePaise: 5000 },
      { ...base, productId: "b", name: "Oil", salePricePaise: 9000, costPricePaise: 10000 },
      { ...base, productId: "c", name: "Salt", salePricePaise: 2000, costPricePaise: 0 },
    ]);
    expect(rows.map((r) => [r.name, r.marginPercent, r.belowCost, r.noCost])).toEqual([
      ["Oil", -11.1, true, false],
      ["Rice", 16.7, false, false],
      ["Salt", null, false, true],
    ]);
  });

  it("compares cost against the price with GST removed", () => {
    // ₹105 incl. 5% is ₹100 ex-tax; a ₹101 cost is below it.
    const [row] = buildMarginRows([
      { productId: "a", name: "Soap", uom: "pcs", salePricePaise: 10500, costPricePaise: 10100, taxRatePercent: 5, isTaxInclusive: true },
    ]);
    expect(row).toMatchObject({ salePriceExTaxPaise: 10000, belowCost: true });
  });
});
