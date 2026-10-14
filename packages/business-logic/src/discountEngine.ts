import { applyPercent } from "./money.js";

export interface LineDiscountInput {
  unitPricePaise: number;
  qty: number;
  discountPercent: number;
  discountFlatPaise: number;
  costPricePaise: number;
  /** If false, a discount that would price the line below cost is rejected. */
  allowBelowCost: boolean;
}

export interface LineDiscountResult {
  grossPaise: number;
  discountPaise: number;
  netUnitPricePaise: number;
}

export class BelowCostDiscountError extends Error {
  constructor(
    public readonly grossPaise: number,
    public readonly discountPaise: number,
    public readonly costPaise: number,
  ) {
    super("Discount would price this line below cost. Manager approval is required.");
    this.name = "BelowCostDiscountError";
  }
}

export function applyLineDiscount(input: LineDiscountInput): LineDiscountResult {
  const grossPaise = Math.round(input.unitPricePaise * input.qty);
  const percentDiscountPaise = applyPercent(grossPaise, input.discountPercent);
  const discountPaise = Math.min(grossPaise, percentDiscountPaise + input.discountFlatPaise);

  const costPaise = Math.round(input.costPricePaise * input.qty);
  if (!input.allowBelowCost && grossPaise - discountPaise < costPaise) {
    throw new BelowCostDiscountError(grossPaise, discountPaise, costPaise);
  }

  const netLinePaise = grossPaise - discountPaise;
  const netUnitPricePaise = input.qty === 0 ? 0 : Math.round(netLinePaise / input.qty);

  return { grossPaise, discountPaise, netUnitPricePaise };
}

export interface ParsedDiscount {
  discountPercent: number;
  discountFlatPaise: number;
}

/**
 * Parses what a cashier types into a discount box. A trailing percent sign ("10%") is a
 * rate; anything else numeric ("5", "₹5", "rs 5") is a flat rupee amount, because that is
 * how a discount gets asked for across a counter. Empty input clears the discount.
 *
 * Returns null for anything unusable — letters, a negative, a rate above 100 — so the
 * caller can mark the box invalid instead of silently applying zero, which would look
 * identical to a discount the cashier believes they just entered.
 */
export function parseDiscountInput(raw: string): ParsedDiscount | null {
  const input = raw.trim();
  if (input.length === 0) return { discountPercent: 0, discountFlatPaise: 0 };

  const percentMatch = input.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    if (!Number.isFinite(percent) || percent > 100) return null;
    return { discountPercent: percent, discountFlatPaise: 0 };
  }

  const flatMatch = input.match(/^(?:₹|rs\.?)?\s*(\d+(?:\.\d+)?)\s*(?:rs\.?)?$/i);
  if (flatMatch) {
    const rupees = Number(flatMatch[1]);
    if (!Number.isFinite(rupees)) return null;
    return { discountPercent: 0, discountFlatPaise: Math.round(rupees * 100) };
  }

  return null;
}

export interface BillDiscountInput {
  subtotalPaise: number;
  billDiscountPercent: number;
  billDiscountFlatPaise: number;
}

export function applyBillDiscount(input: BillDiscountInput): number {
  const percentDiscountPaise = applyPercent(input.subtotalPaise, input.billDiscountPercent);
  return Math.min(input.subtotalPaise, percentDiscountPaise + input.billDiscountFlatPaise);
}
