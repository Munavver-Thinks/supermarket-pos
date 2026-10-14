import { formatIndianCurrency } from "./money.js";
import { exTaxPricePaise } from "./stockInsights.js";

/**
 * When new stock arrives at a different cost than what's already on the shelf, the product's
 * cost price becomes a weighted average of the stock already on hand and the newly received
 * stock — not a flat overwrite. Uses the line's total taxable (ex-GST) paise rather than
 * per-unit cost × qty, so blending doesn't drift from paise rounding.
 *
 * Returns the cost unchanged when there's nothing meaningful to blend in (no qty received, or
 * no taxable value — a line with a free/zero cost is treated as blank, never overwrites a real
 * cost). Callers decide whether to call this at all (e.g. only when "update cost price" is on).
 */
export function weightedAverageCost(input: {
  qtyOnHandBefore: number;
  currentCostPaise: number;
  qtyReceived: number;
  receivedTaxablePaise: number;
}): number {
  const { qtyOnHandBefore, currentCostPaise, qtyReceived, receivedTaxablePaise } = input;
  if (qtyReceived <= 0 || receivedTaxablePaise <= 0) return currentCostPaise;

  const oldQty = Math.max(qtyOnHandBefore, 0);
  const unitCost = Math.round(receivedTaxablePaise / qtyReceived);
  if (oldQty <= 0 || currentCostPaise <= 0) return unitCost;

  return Math.round((oldQty * currentCostPaise + receivedTaxablePaise) / (oldQty + qtyReceived));
}

export type MarginWarningKind = "sale" | "wholesale";

export interface MarginWarning {
  kind: MarginWarningKind;
  costPricePaise: number;
  pricePaise: number;
  priceExTaxPaise: number;
  message: string;
}

/**
 * Soft warning (never a hard block) for a cost price that leaves no profit: cost >= the
 * ex-GST selling price, and separately cost >= the ex-GST wholesale price when one is set.
 * Cost 0 means "no cost recorded" and never warns. Equal cost and price counts as a warning.
 */
export function findMarginWarnings(input: {
  costPricePaise: number;
  salePricePaise: number;
  wholesalePricePaise: number | null;
  taxRatePercent: number;
  isTaxInclusive: boolean;
}): MarginWarning[] {
  const { costPricePaise, salePricePaise, wholesalePricePaise, taxRatePercent, isTaxInclusive } = input;
  if (costPricePaise <= 0) return [];

  const suffix = (pricePaise: number): string =>
    isTaxInclusive && taxRatePercent > 0 ? ` (${formatIndianCurrency(pricePaise)} incl. GST)` : "";

  const warnings: MarginWarning[] = [];

  const saleExTax = exTaxPricePaise(salePricePaise, taxRatePercent, isTaxInclusive);
  if (costPricePaise >= saleExTax) {
    warnings.push({
      kind: "sale",
      costPricePaise,
      pricePaise: salePricePaise,
      priceExTaxPaise: saleExTax,
      message: `No profit: cost ${formatIndianCurrency(costPricePaise)} is not below the selling price ${formatIndianCurrency(saleExTax)}${suffix(salePricePaise)}.`,
    });
  }

  if (wholesalePricePaise != null) {
    const wholesaleExTax = exTaxPricePaise(wholesalePricePaise, taxRatePercent, isTaxInclusive);
    if (costPricePaise >= wholesaleExTax) {
      warnings.push({
        kind: "wholesale",
        costPricePaise,
        pricePaise: wholesalePricePaise,
        priceExTaxPaise: wholesaleExTax,
        message: `No profit on wholesale bills: cost ${formatIndianCurrency(costPricePaise)} is not below the wholesale price ${formatIndianCurrency(wholesaleExTax)}${suffix(wholesalePricePaise)}.`,
      });
    }
  }

  return warnings;
}

/** Confirm-on-save text for a single product's price form (AddProductModal / ProductEditModal). */
export function marginConfirmText(productName: string, warnings: MarginWarning[]): string {
  const lines = warnings.map((w) => w.message).join("\n");
  return `${productName}: ${lines}\n\nSave these prices anyway?`;
}

/** Confirm-on-receive text for the purchase screens, listing every line that warns. */
export function purchaseMarginConfirmText(
  rows: Array<{ name: string; costPricePaise: number; salePricePaise: number }>,
): string {
  const lines = rows.map(
    (r) => `• ${r.name} — cost ${formatIndianCurrency(r.costPricePaise)}, sells at ${formatIndianCurrency(r.salePricePaise)}`,
  );
  return `These items cost as much as or more than they sell for:\n${lines.join("\n")}\n\nReceive anyway? You can change selling prices later from Inventory.`;
}
