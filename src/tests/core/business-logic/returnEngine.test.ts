import { describe, expect, it } from "vitest";

import { computeCartTotals } from "@/core/business-logic/billingService.js";
import { computeReturnTotals, ReturnQuantityError, type ReturnLineInput } from "@/core/business-logic/returnEngine.js";

function line(overrides: Partial<ReturnLineInput> = {}): ReturnLineInput {
  return {
    saleItemId: "item-1",
    productId: "prod-1",
    soldQty: 4,
    alreadyReturnedQty: 0,
    returnQty: 2,
    discountPaise: 400,
    taxablePaise: 8000,
    cgstPaise: 200,
    sgstPaise: 200,
    lineTotalPaise: 8400,
    ...overrides,
  };
}

describe("computeReturnTotals", () => {
  it("refunds a proportional slice of what was charged", () => {
    const { lines, totals } = computeReturnTotals([line()]);
    expect(lines[0]?.qty).toBe(2);
    expect(lines[0]?.taxablePaise).toBe(4000);
    expect(lines[0]?.cgstPaise).toBe(100);
    expect(lines[0]?.discountPaise).toBe(200);
    expect(totals.refundPaise).toBe(4200);
  });

  it("skips lines with nothing selected", () => {
    const { lines } = computeReturnTotals([line({ returnQty: 0 }), line({ saleItemId: "item-2", returnQty: 1 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.saleItemId).toBe("item-2");
  });

  it("refuses to return more than was sold", () => {
    expect(() => computeReturnTotals([line({ returnQty: 5 })])).toThrow(ReturnQuantityError);
  });

  it("counts what already came back on earlier returns", () => {
    expect(() => computeReturnTotals([line({ alreadyReturnedQty: 3, returnQty: 2 })])).toThrow(
      /Only 1 of this item is left/,
    );
    // One more is still allowed.
    expect(computeReturnTotals([line({ alreadyReturnedQty: 3, returnQty: 1 })]).lines).toHaveLength(1);
  });

  it("refuses an empty return", () => {
    expect(() => computeReturnTotals([line({ returnQty: 0 })])).toThrow(/Nothing selected/);
  });

  it("handles a weighed line returned in part", () => {
    const { totals } = computeReturnTotals([
      line({ soldQty: 1.5, returnQty: 0.5, lineTotalPaise: 9000, taxablePaise: 9000, cgstPaise: 0, sgstPaise: 0 }),
    ]);
    // A third of the line: 3000 paise, then rounded to the nearest rupee.
    expect(totals.refundPaise).toBe(3000);
  });

  it("refunds a full return of every line as exactly the bill's net", () => {
    // The property that matters: returning everything must put the customer back where they
    // started, to the paise, including the sale's own rounding.
    const cart = {
      clientTxnId: "txn-1",
      storeId: "store-1",
      counterId: "counter-1",
      userId: "user-1",
      customerId: null,
      billDiscountPercent: 7,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: "l1",
          productId: "p1",
          name: "Rice",
          uom: "kg",
          qty: 3,
          unitPricePaise: 6250,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
        {
          lineId: "l2",
          productId: "p2",
          name: "Oil",
          uom: "l",
          qty: 2,
          unitPricePaise: 14999,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 10,
          discountFlatPaise: 0,
        },
      ],
    };

    const sale = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });

    const returned = computeReturnTotals(
      sale.lines.map((l, index) => ({
        saleItemId: `item-${index}`,
        productId: l.productId,
        soldQty: l.qty,
        alreadyReturnedQty: 0,
        returnQty: l.qty,
        discountPaise: l.discountPaise,
        taxablePaise: l.taxablePaise,
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        lineTotalPaise: l.totalPaise,
      })),
    );

    expect(returned.totals.refundPaise).toBe(sale.totals.netPaise);
  });
});
