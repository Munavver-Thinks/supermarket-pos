import type { CartLine } from "@pos/types";
import { describe, expect, it } from "vitest";

import { capLinesAtMrp, findMrpWarnings, mrpLoweredText, mrpRefusalText, purchaseMrpConfirmText } from "@/core/business-logic/mrp.js";

function line(overrides: Partial<CartLine>): CartLine {
  return {
    lineId: overrides.lineId ?? "line-1",
    productId: overrides.productId ?? "product-1",
    name: overrides.name ?? "Toor Dal",
    uom: overrides.uom ?? "kg",
    qty: overrides.qty ?? 1,
    unitPricePaise: overrides.unitPricePaise ?? 0,
    isTaxInclusive: overrides.isTaxInclusive ?? true,
    taxRatePercent: overrides.taxRatePercent ?? 0,
    discountPercent: overrides.discountPercent ?? 0,
    discountFlatPaise: overrides.discountFlatPaise ?? 0,
  };
}

describe("capLinesAtMrp", () => {
  it("lowers a line priced above its cap and leaves one at or below it untouched", () => {
    const lines = [
      line({ lineId: "a", productId: "p1", unitPricePaise: 4000 }),
      line({ lineId: "b", productId: "p2", unitPricePaise: 3000 }),
    ];
    const { lines: capped, lowered } = capLinesAtMrp(lines, { p1: 3500, p2: 3500 });

    expect(capped.find((l) => l.lineId === "a")?.unitPricePaise).toBe(3500);
    expect(capped.find((l) => l.lineId === "b")).toBe(lines[1]); // untouched, same object
    expect(lowered).toEqual([{ name: "Toor Dal", fromPaise: 4000, toPaise: 3500 }]);
  });

  it("caps each of two lines for the same product independently", () => {
    const lines = [
      line({ lineId: "a", productId: "p1", name: "Sugar", unitPricePaise: 5000 }),
      line({ lineId: "b", productId: "p1", name: "Sugar", unitPricePaise: 4200 }),
    ];
    const { lines: capped, lowered } = capLinesAtMrp(lines, { p1: 4500 });

    expect(capped.find((l) => l.lineId === "a")?.unitPricePaise).toBe(4500);
    expect(capped.find((l) => l.lineId === "b")?.unitPricePaise).toBe(4200); // already under the cap
    expect(lowered).toEqual([{ name: "Sugar", fromPaise: 5000, toPaise: 4500 }]);
  });

  it("never raises a price for a product with no cap", () => {
    const lines = [line({ productId: "p1", unitPricePaise: 3000 })];
    const { lines: capped, lowered } = capLinesAtMrp(lines, {});
    expect(capped).toEqual(lines);
    expect(lowered).toEqual([]);
  });

  it("caps a wholesale-rate line the same as a sale-rate line — the rate is already baked into unitPricePaise", () => {
    const wholesaleLine = line({ productId: "p1", unitPricePaise: 3800 });
    const { lines: capped, lowered } = capLinesAtMrp([wholesaleLine], { p1: 3500 });
    expect(capped[0]?.unitPricePaise).toBe(3500);
    expect(lowered).toHaveLength(1);
  });
});

describe("findMrpWarnings", () => {
  it("warns when the sale price is above the MRP", () => {
    const warnings = findMrpWarnings({ mrpPaise: 3500, salePricePaise: 3800, wholesalePricePaise: null });
    expect(warnings).toEqual([
      {
        kind: "sale",
        message: "MRP ₹35.00 is below the selling price ₹38.00 — the selling price will be lowered to ₹35.00.",
      },
    ]);
  });

  it("warns separately when a wholesale rate is also above the MRP", () => {
    const warnings = findMrpWarnings({ mrpPaise: 3500, salePricePaise: 3800, wholesalePricePaise: 3600 });
    expect(warnings.map((w) => w.kind)).toEqual(["sale", "wholesale"]);
  });

  it("never warns when there is no MRP recorded", () => {
    expect(findMrpWarnings({ mrpPaise: 0, salePricePaise: 3800, wholesalePricePaise: 3600 })).toEqual([]);
  });

  it("doesn't warn when the MRP covers both prices", () => {
    expect(findMrpWarnings({ mrpPaise: 4000, salePricePaise: 3800, wholesalePricePaise: 3600 })).toEqual([]);
  });
});

describe("text builders", () => {
  it("formats the lowered-price status text", () => {
    expect(mrpLoweredText([{ name: "Toor Dal", fromPaise: 4000, toPaise: 3500 }])).toBe(
      "Price lowered to the printed MRP: Toor Dal ₹40.00 → ₹35.00.",
    );
  });

  it("formats the refusal text", () => {
    expect(mrpRefusalText([{ name: "Toor Dal", fromPaise: 4000, toPaise: 3500 }])).toBe(
      "Price is above the printed MRP of the stock being sold: Toor Dal ₹40.00 → ₹35.00. " +
        "The bill has been corrected — check the new total and take payment again.",
    );
  });

  it("formats the purchase-receive confirm text", () => {
    expect(purchaseMrpConfirmText([{ name: "Toor Dal", mrpPaise: 3500, salePricePaise: 3800 }])).toBe(
      "These items' new MRP is below what they sell for:\n" +
        "• Toor Dal — MRP ₹35.00, sells at ₹38.00\n\n" +
        "Receive anyway? Their selling price will be lowered to the new MRP.",
    );
  });
});
