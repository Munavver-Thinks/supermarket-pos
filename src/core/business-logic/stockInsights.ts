import type { MarginRow } from "@pos/types";

import { computeLineTax } from "./taxEngine.js";

/**
 * Small calculations behind the profit, margin and stock-movement reports. Money figures stay
 * integer paise; only the percentages and day counts are decimals, rounded for display.
 */

/** Profit as a share of what was taken (ex-tax), to one decimal. Null when nothing was taken. */
export function marginPercent(revenuePaise: number, costPaise: number): number | null {
  if (revenuePaise <= 0) return null;
  return Math.round(((revenuePaise - costPaise) / revenuePaise) * 1000) / 10;
}

/**
 * How many days the stock on hand lasts at the rate it sold over the look-back window.
 * Null when nothing sold — "forever" isn't a number a report should print.
 */
export function daysOfCover(qtyOnHand: number, qtySold: number, windowDays: number): number | null {
  if (qtySold <= 0 || windowDays <= 0) return null;
  return Math.round((qtyOnHand / (qtySold / windowDays)) * 10) / 10;
}

/**
 * The sale price with GST taken out — the figure a cost price compares against, since cost
 * is recorded tax-exclusive. Uses the billing tax engine so rounding matches a real bill.
 */
export function exTaxPricePaise(pricePaise: number, taxRatePercent: number, isTaxInclusive: boolean): number {
  return computeLineTax({ netUnitPricePaise: pricePaise, qty: 1, isTaxInclusive, taxRatePercent }).taxablePaise;
}

export interface CurrentPriceRow {
  productId: string;
  name: string;
  uom: string;
  salePricePaise: number;
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
}

/**
 * The margin report: each product's current sale price (ex-tax) against its recorded cost.
 * A product with no cost recorded is flagged rather than shown as 100% margin.
 * Worst margins first, products without a cost at the end.
 */
export function buildMarginRows(prices: CurrentPriceRow[]): MarginRow[] {
  return prices
    .map((p): MarginRow => {
      const salePriceExTaxPaise = exTaxPricePaise(p.salePricePaise, p.taxRatePercent, p.isTaxInclusive);
      const noCost = p.costPricePaise <= 0;
      return {
        productId: p.productId,
        name: p.name,
        uom: p.uom,
        salePricePaise: p.salePricePaise,
        salePriceExTaxPaise,
        costPricePaise: p.costPricePaise,
        marginPercent: noCost ? null : marginPercent(salePriceExTaxPaise, p.costPricePaise),
        belowCost: !noCost && salePriceExTaxPaise < p.costPricePaise,
        noCost,
      };
    })
    .sort((a, b) => {
      if (a.noCost !== b.noCost) return a.noCost ? 1 : -1;
      return (a.marginPercent ?? 0) - (b.marginPercent ?? 0) || a.name.localeCompare(b.name);
    });
}
