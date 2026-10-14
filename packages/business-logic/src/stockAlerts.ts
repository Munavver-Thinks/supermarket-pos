import type { ExpiringBatchRow, LowStockRow, StockAlert, StockAlertKind } from "@pos/types";

import { classifyExpiry } from "./expiryPolicy.js";
import { formatStockQty as qty, totalStockQty } from "./packStock.js";

/** Lower is more urgent: nothing to sell beats goods that can't be sold, and so on. */
const SEVERITY: Record<StockAlertKind, number> = {
  out_of_stock: 0,
  expired: 1,
  low_stock: 2,
  expiring: 3,
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Everything on the shelf that needs someone's attention, most urgent first. Low stock
 * comes from the shared low-stock definition (see inventory getLowStock) and expiry from the
 * batch list; batches are re-classified against `today` so a stale list can't mislabel one.
 */
export function buildStockAlerts(input: {
  lowStock: LowStockRow[];
  batches: ExpiringBatchRow[];
  today: string;
  alertDays: number;
}): StockAlert[] {
  const alerts: StockAlert[] = [];

  for (const row of input.lowStock) {
    const total = totalStockQty(row.qtyOnHand, row.packStockQty);
    const kind: StockAlertKind = total <= 0 ? "out_of_stock" : "low_stock";
    // A product with no reorder level only ever alerts when it runs out.
    if (kind === "low_stock" && !(row.reorderLevel > 0 && total <= row.reorderLevel)) continue;
    const isParent = row.packStockQty !== null;
    const pack = row.packStockQty ?? 0;
    let detail: string;
    if (!isParent) {
      detail =
        kind === "out_of_stock"
          ? `Out of stock (${qty(row.qtyOnHand)} ${row.uom})`
          : `${qty(row.qtyOnHand)} ${row.uom} left — reorder level ${qty(row.reorderLevel)}`;
    } else {
      detail =
        kind === "out_of_stock"
          ? `Out of stock — ${qty(row.qtyOnHand)} ${row.uom} loose, ${qty(pack)} ${row.uom} in packs`
          : `${qty(total)} ${row.uom} left (${qty(row.qtyOnHand)} ${row.uom} loose + ${qty(pack)} ${row.uom} in packs) — reorder level ${qty(row.reorderLevel)}`;
    }
    alerts.push({
      key: `${kind}:${row.productId}`,
      kind,
      productId: row.productId,
      name: row.name,
      detail,
      severity: SEVERITY[kind],
    });
  }

  for (const batch of input.batches) {
    const status = classifyExpiry(batch.expiryDate, input.today, input.alertDays);
    if (status === "ok" || batch.qtyRemaining <= 0) continue;
    const label = batch.batchNo ? `Batch ${batch.batchNo}: ` : "";
    const amount = `${qty(batch.qtyRemaining)} ${batch.uom}`;
    const days = daysBetween(input.today, batch.expiryDate);
    alerts.push({
      key: `${status}:${batch.batchId}`,
      kind: status,
      productId: batch.productId,
      name: batch.productName,
      detail:
        status === "expired"
          ? `${label}${amount} past expiry (${batch.expiryDate})`
          : `${label}${amount} expire${days === 0 ? " today" : ` in ${days} day${days === 1 ? "" : "s"}`} (${batch.expiryDate})`,
      severity: SEVERITY[status],
    });
  }

  return alerts.sort((a, b) => a.severity - b.severity || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/**
 * Identifies the set of alerts, not their figures: stock going from 3 to 2 of an item that is
 * already low is the same alert, so a dismissed banner stays dismissed until something new
 * needs attention (or something is resolved).
 */
export function alertsSignature(alerts: StockAlert[]): string {
  return alerts
    .map((a) => a.key)
    .sort()
    .join("|");
}

/** "4 items need attention: 3 low stock, 1 expiring". Empty when there is nothing to say. */
export function summarizeAlerts(alerts: StockAlert[]): string {
  if (alerts.length === 0) return "";
  const counts: Array<[StockAlertKind, string]> = [
    ["out_of_stock", "out of stock"],
    ["low_stock", "low stock"],
    ["expired", "expired"],
    ["expiring", "expiring"],
  ];
  const parts = counts
    .map(([kind, label]) => [alerts.filter((a) => a.kind === kind).length, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  const total = alerts.length;
  return `${total} ${total === 1 ? "item needs" : "items need"} attention: ${parts.join(", ")}`;
}
