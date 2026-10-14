import { describe, expect, it } from "vitest";
import type { Cart } from "@pos/types";

import { computeCartTotals } from "./billingService.js";

function baseCart(overrides: Partial<Cart> = {}): Cart {
  return {
    clientTxnId: "11111111-1111-1111-1111-111111111111",
    storeId: "store-1",
    counterId: "counter-1",
    userId: "user-1",
    customerId: null,
    lines: [],
    billDiscountPercent: 0,
    billDiscountFlatPaise: 0,
    heldAt: null,
    ...overrides,
  };
}

describe("computeCartTotals", () => {
  it("computes a single-line tax-inclusive bill with no discount", () => {
    const cart = baseCart({
      lines: [
        {
          lineId: "l1",
          productId: "p1",
          name: "Aachi Chilli Powder 200g",
          uom: "pcs",
          qty: 2,
          unitPricePaise: 11800,
          isTaxInclusive: true,
          taxRatePercent: 18,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    });

    const { totals, lines } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: false });

    expect(lines[0]?.totalPaise).toBe(23600);
    expect(totals.taxablePaise).toBe(20000);
    expect(totals.cgstPaise).toBe(1800);
    expect(totals.sgstPaise).toBe(1800);
    expect(totals.netPaise).toBe(23600);
    expect(totals.roundOffPaise).toBe(0);
  });

  it("distributes a bill-level discount proportionally across lines", () => {
    const cart = baseCart({
      billDiscountPercent: 10,
      lines: [
        {
          lineId: "l1",
          productId: "p1",
          name: "Item A",
          uom: "pcs",
          qty: 1,
          unitPricePaise: 10000,
          isTaxInclusive: true,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
        {
          lineId: "l2",
          productId: "p2",
          name: "Item B",
          uom: "pcs",
          qty: 1,
          unitPricePaise: 10000,
          isTaxInclusive: true,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    });

    const { totals } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: false });
    // subtotal 20000, 10% bill discount = 2000 off => 18000 net
    expect(totals.netPaise).toBe(18000);
    expect(totals.discountPaise).toBe(2000);
  });

  it("rounds the final total to the nearest rupee", () => {
    const cart = baseCart({
      lines: [
        {
          lineId: "l1",
          productId: "p1",
          name: "Item",
          uom: "kg",
          qty: 1.85,
          unitPricePaise: 6000,
          isTaxInclusive: false,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    });

    const { totals } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: false });
    expect(totals.netPaise).toBe(11100);
    expect(totals.roundOffPaise).toBe(0);
  });

  it("is idempotent in shape for an empty cart", () => {
    const { totals, lines } = computeCartTotals(baseCart(), {
      costPricePaiseByProduct: {},
      allowBelowCost: false,
    });
    expect(lines).toEqual([]);
    expect(totals.netPaise).toBe(0);
  });
});
