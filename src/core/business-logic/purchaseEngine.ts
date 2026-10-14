import { applyPercent, extractTaxableFromInclusive } from "./money.js";

export interface PurchaseLineInput {
  productId: string;
  qty: number;
  /** Per-unit price charged by the supplier, tax-inclusive or -exclusive per the flag. */
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
  /** Optional batch details; every line opens a stock batch, with or without either one. */
  batchNo?: string | null | undefined;
  /** YYYY-MM-DD, the last day the goods may be sold. */
  expiryDate?: string | null | undefined;
  /** Printed MRP on the received packs; null/absent = same as the product's current MRP. */
  mrpPaise?: number | null | undefined;
}

export interface PurchaseLineTotal {
  productId: string;
  qty: number;
  costPricePaise: number;
  taxRatePercent: number;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
  batchNo?: string | null | undefined;
  expiryDate?: string | null | undefined;
  mrpPaise?: number | null | undefined;
}

export interface PurchaseTotals {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/**
 * Totals one supplier invoice: taxable value, GST, and line/invoice totals.
 *
 * Purchase invoices are usually tax-exclusive (the supplier lists a rate and adds GST),
 * which is the mirror image of the tax-inclusive MRP the sale side works in — so both
 * cases are supported and both route through the same rounding helpers as the billing
 * engine, keeping paisa rounding identical on the buy and sell sides.
 *
 * Tax is kept as a single figure rather than a CGST/SGST split: Phase 1 files no GST
 * returns, so an input-tax-credit breakdown would be a field nothing reads.
 */
export function computePurchaseTotals(lines: PurchaseLineInput[]): {
  lines: PurchaseLineTotal[];
  totals: PurchaseTotals;
} {
  const computed = lines.map((line): PurchaseLineTotal => {
    const grossLinePaise = Math.round(line.costPricePaise * line.qty);

    const taxablePaise = line.isTaxInclusive
      ? extractTaxableFromInclusive(grossLinePaise, line.taxRatePercent)
      : grossLinePaise;

    const taxPaise = line.isTaxInclusive
      ? grossLinePaise - taxablePaise
      : applyPercent(taxablePaise, line.taxRatePercent);

    return {
      productId: line.productId,
      qty: line.qty,
      costPricePaise: line.costPricePaise,
      taxRatePercent: line.taxRatePercent,
      taxablePaise,
      taxPaise,
      lineTotalPaise: taxablePaise + taxPaise,
      // Passed through untouched, and only when given, so a line that sets none of these
      // looks exactly as it did before they existed.
      ...(line.batchNo ? { batchNo: line.batchNo } : {}),
      ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
      ...(line.mrpPaise != null ? { mrpPaise: line.mrpPaise } : {}),
    };
  });

  const subtotalPaise = computed.reduce((sum, line) => sum + line.taxablePaise, 0);
  const taxPaise = computed.reduce((sum, line) => sum + line.taxPaise, 0);

  return {
    lines: computed,
    totals: { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise },
  };
}

/**
 * The per-unit cost to record against the product after receiving goods — always the
 * tax-exclusive unit cost, so it compares like-for-like with the tax-exclusive cost price
 * the below-cost discount guard checks against at billing time.
 */
export function unitCostFromLine(line: PurchaseLineTotal): number {
  if (line.qty === 0) return 0;
  return Math.round(line.taxablePaise / line.qty);
}
