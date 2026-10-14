import type { ExpiryStatus } from "@pos/types";

/**
 * Expiry rules for batch-tracked stock.
 *
 * Dates are plain local calendar days (YYYY-MM-DD), compared as strings. An expiry date is
 * the last day the goods may be sold, so a batch is expired only once that day has passed —
 * something dated today can still go out today.
 */

/** The app_settings key for "refuse to bill stock that is past expiry". */
export const BLOCK_EXPIRED_SALE_KEY = "stock.blockExpiredSale";

/** How far ahead "expiring soon" looks. Fixed for now, not a setting. */
export const EXPIRY_ALERT_DAYS = 30;

/**
 * Off unless explicitly switched on. Most kiranas record expiry for only some of their
 * stock, so refusing a sale by default would stop the counter over data nobody entered.
 */
export function parseBlockExpiredSale(raw: string | undefined | null): boolean {
  return raw === "true";
}

/** Today's (or the given instant's) calendar date in local time, as YYYY-MM-DD. */
export function localDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Adds whole days to a YYYY-MM-DD date. Done in UTC so a DST shift can't skip or repeat a day. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function classifyExpiry(expiryDate: string | null, today: string, alertDays: number): ExpiryStatus {
  if (!expiryDate) return "ok";
  if (expiryDate < today) return "expired";
  if (expiryDate <= addDaysIso(today, alertDays)) return "expiring";
  return "ok";
}

export interface ExpiryLineInput {
  productId: string;
  name: string;
  qty: number;
}

export interface ExpiredConflict {
  productId: string;
  name: string;
  requestedQty: number;
  onHandQty: number;
  expiredQty: number;
}

/**
 * Lines that can only be filled by selling expired goods: the bill asks for more than the
 * stock that is still in date. Quantities are summed per product first, the same way the
 * negative-stock check does. A product with no expired batches never conflicts, so a shop
 * that doesn't record expiry sells exactly as before.
 */
export function findExpiredStockConflicts(
  lines: ExpiryLineInput[],
  onHandByProduct: Record<string, number>,
  expiredQtyByProduct: Record<string, number>,
): ExpiredConflict[] {
  const requested = new Map<string, ExpiredConflict>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const existing = requested.get(line.productId);
    if (existing) {
      existing.requestedQty += line.qty;
    } else {
      requested.set(line.productId, {
        productId: line.productId,
        name: line.name,
        requestedQty: line.qty,
        onHandQty: onHandByProduct[line.productId] ?? 0,
        expiredQty: expiredQtyByProduct[line.productId] ?? 0,
      });
    }
  }

  // Same float tolerance as the stock check, so weighed quantities don't trip on drift.
  return [...requested.values()].filter(
    (c) => c.expiredQty > 1e-9 && c.requestedQty - (c.onHandQty - c.expiredQty) > 1e-9,
  );
}

function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

export function describeExpiredConflicts(conflicts: ExpiredConflict[]): string {
  return conflicts
    .map(
      (c) =>
        `${c.name}: ${roundQty(c.expiredQty)} of ${roundQty(c.onHandQty)} on hand are past expiry — ` +
        "write them off in Inventory before selling.",
    )
    .join(" ");
}

export class ExpiredStockError extends Error {
  constructor(public readonly conflicts: ExpiredConflict[]) {
    super(describeExpiredConflicts(conflicts));
    this.name = "ExpiredStockError";
  }
}
