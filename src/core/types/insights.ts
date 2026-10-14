import type { PaymentModeTotal } from "./sale.js";

/** Today's figures for the dashboard. Nothing here is estimated except gross profit, which says so. */
export interface DashboardSummary {
  /** Today's completed bills, before refunds. */
  netPaise: number;
  billCount: number;
  paymentMix: PaymentModeTotal[];
  /** Refunds given today. */
  refundPaise: number;
  /** Estimate at recorded cost; null for roles that can't see reports. */
  grossProfitPaise: number | null;
  /** Products sold today with no cost price recorded; null alongside grossProfitPaise. */
  productsWithoutCost: number | null;
  lowStockCount: number;
  expiringCount: number;
  expiredCount: number;
  /** Every customer in the store. */
  customerCount: number;
  /** Distinct customers named on today's bills. */
  customersServedToday: number;
}

export type LowStockKind = "out_of_stock" | "low_stock";

/**
 * Active products at or below their reorder level. out_of_stock: nothing left (total ≤ 0);
 * low_stock: a reorder level is set and 0 < total ≤ that level. Thresholds are checked against
 * `qtyOnHand + (packStockQty ?? 0)` — a bulk product's pack sizes count as stock already owned.
 */
export interface LowStockRow {
  productId: string;
  name: string;
  uom: string;
  /** The product's own count — what the Inventory screen's "Adjust" button reads. */
  qtyOnHand: number;
  reorderLevel: number;
  /** Stock held in this product's pack sizes, in its own uom. Null when it has none. */
  packStockQty: number | null;
  kind: LowStockKind;
}

export interface ProfitReportRow {
  productId: string;
  name: string;
  uom: string;
  /** Sold minus returned. */
  qtySold: number;
  /** Taxable value, net of returns. */
  taxablePaise: number;
  /** Cost of goods at the cost in effect when each bill was made. */
  costPaise: number;
  profitPaise: number;
  /** Null when there is no taxable value to divide by. */
  marginPercent: number | null;
  /** False when some of the goods had no cost price recorded (counted as zero cost). */
  hasCost: boolean;
}

export interface ProfitReport {
  taxablePaise: number;
  costPaise: number;
  profitPaise: number;
  marginPercent: number | null;
  /** Products in the report with no cost price recorded. */
  productsWithoutCost: number;
  rows: ProfitReportRow[];
}

export interface SlowMovingRow {
  productId: string;
  name: string;
  uom: string;
  qtyOnHand: number;
  /** Net quantity sold in the look-back window. */
  qtySold: number;
  /** How long the current stock lasts at that rate. */
  daysOfCover: number;
  valuePaise: number;
}

export interface DeadStockRow {
  productId: string;
  name: string;
  uom: string;
  qtyOnHand: number;
  /** Null when the product has never been sold. */
  lastSoldAt: string | null;
  /** On-hand at the current cost price. */
  valuePaise: number;
}

export interface MarginRow {
  productId: string;
  name: string;
  uom: string;
  salePricePaise: number;
  /** The sale price with GST taken out, which is what cost is compared against. */
  salePriceExTaxPaise: number;
  costPricePaise: number;
  /** Null when there is no cost price to compare with. */
  marginPercent: number | null;
  belowCost: boolean;
  noCost: boolean;
}

export type StockAlertKind = "out_of_stock" | "low_stock" | "expired" | "expiring";

export interface StockAlert {
  /** Stable per product + kind (+ batch), so a changed set of alerts can be told apart from the same set. */
  key: string;
  kind: StockAlertKind;
  productId: string;
  name: string;
  detail: string;
  /** Lower is more urgent. */
  severity: number;
}
