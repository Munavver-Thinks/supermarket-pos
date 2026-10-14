import { roundToNearestRupee } from "./money.js";

export interface ReturnLineInput {
  saleItemId: string;
  productId: string;
  /** Quantity on the original bill. */
  soldQty: number;
  /** Quantity already sent back on earlier credit notes for this bill. */
  alreadyReturnedQty: number;
  /** Quantity being returned now. */
  returnQty: number;
  // What the customer was actually charged for the whole original line. The bill-level
  // discount was already scaled into these by computeCartTotals, so a proportional slice
  // of them reverses that discount too, without having to reason about it again here.
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export interface ReturnLineTotal {
  saleItemId: string;
  productId: string;
  qty: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export interface ReturnTotals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  discountPaise: number;
  roundOffPaise: number;
  refundPaise: number;
}

export interface ReturnTotalsResult {
  lines: ReturnLineTotal[];
  totals: ReturnTotals;
}

export class ReturnQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReturnQuantityError";
  }
}

/**
 * Works out what to refund for a partial or full return. Each line is refunded as the same
 * proportion of what was charged for it, so tax and discount come back in the ratio they
 * went out — the customer is put back exactly where they were for the goods they returned.
 *
 * Rounding runs once at the end through the shared money helper, which is what makes a
 * return of every line refund exactly the bill's net: the sum being rounded is the same
 * sum the original sale rounded.
 */
export function computeReturnTotals(inputLines: ReturnLineInput[]): ReturnTotalsResult {
  const lines: ReturnLineTotal[] = [];

  for (const line of inputLines) {
    if (line.returnQty <= 0) continue;

    if (line.soldQty <= 0) {
      throw new ReturnQuantityError("The original bill line has no quantity to return.");
    }

    const remaining = line.soldQty - line.alreadyReturnedQty;
    if (line.returnQty > remaining) {
      throw new ReturnQuantityError(
        `Only ${remaining} of this item is left to return — ${line.alreadyReturnedQty} of ${line.soldQty} already came back.`,
      );
    }

    const proportion = line.returnQty / line.soldQty;
    lines.push({
      saleItemId: line.saleItemId,
      productId: line.productId,
      qty: line.returnQty,
      discountPaise: Math.round(line.discountPaise * proportion),
      taxablePaise: Math.round(line.taxablePaise * proportion),
      cgstPaise: Math.round(line.cgstPaise * proportion),
      sgstPaise: Math.round(line.sgstPaise * proportion),
      lineTotalPaise: Math.round(line.lineTotalPaise * proportion),
    });
  }

  if (lines.length === 0) {
    throw new ReturnQuantityError("Nothing selected to return.");
  }

  const beforeRoundingPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const { roundOffPaise, roundedPaise } = roundToNearestRupee(beforeRoundingPaise);

  return {
    lines,
    totals: {
      taxablePaise: lines.reduce((sum, l) => sum + l.taxablePaise, 0),
      cgstPaise: lines.reduce((sum, l) => sum + l.cgstPaise, 0),
      sgstPaise: lines.reduce((sum, l) => sum + l.sgstPaise, 0),
      discountPaise: lines.reduce((sum, l) => sum + l.discountPaise, 0),
      roundOffPaise,
      refundPaise: roundedPaise,
    },
  };
}
