import type { ReturnableSale } from "@pos/types";
import { describe, expect, it } from "vitest";

import { previewReturn } from "@/main-modules/returns/previewReturn.js";

const sale = {
  lines: [
    {
      saleItemId: "si1",
      productId: "p1",
      productName: "Rice",
      uom: "pcs",
      soldQty: 4,
      alreadyReturnedQty: 1,
      returnableQty: 3,
      discountPaise: 0,
      taxablePaise: 40000,
      cgstPaise: 1000,
      sgstPaise: 1000,
      lineTotalPaise: 42000,
    },
  ],
} as unknown as ReturnableSale;

describe("previewReturn", () => {
  it("selects nothing and refunds nothing when no quantity is typed", () => {
    expect(previewReturn(sale, {})).toEqual({ selected: [], refundPaise: 0, previewError: null });
    expect(previewReturn(sale, { si1: "0" }).selected).toEqual([]);
  });

  it("prices a partial return through the real return engine", () => {
    const preview = previewReturn(sale, { si1: "1" });
    expect(preview.previewError).toBeNull();
    expect(preview.selected).toHaveLength(1);
    expect(preview.refundPaise).toBeGreaterThan(0);
    expect(preview.refundPaise).toBeLessThan(42000);
  });

  it("reports an error instead of a refund when more is returned than can be", () => {
    const preview = previewReturn(sale, { si1: "9" });
    expect(preview.refundPaise).toBe(0);
    expect(preview.previewError).toBeTruthy();
  });
});
