import type { ExpiringBatchRow, LowStockRow } from "@pos/types";
import { describe, expect, it } from "vitest";

import { alertsSignature, buildStockAlerts, summarizeAlerts } from "./stockAlerts.js";

const TODAY = "2026-09-16";

function low(
  name: string,
  qtyOnHand: number,
  reorderLevel: number,
  packStockQty: number | null = null,
): LowStockRow {
  return {
    productId: `p-${name}`,
    name,
    uom: "pcs",
    qtyOnHand,
    reorderLevel,
    packStockQty,
    kind: qtyOnHand + (packStockQty ?? 0) <= 0 ? "out_of_stock" : "low_stock",
  };
}

function batch(name: string, expiryDate: string, qtyRemaining = 4, batchNo: string | null = "B1"): ExpiringBatchRow {
  return {
    batchId: `b-${name}-${expiryDate}`,
    productId: `p-${name}`,
    productName: name,
    uom: "pcs",
    batchNo,
    expiryDate,
    qtyRemaining,
    costPricePaise: 100,
    valuePaise: 100 * qtyRemaining,
    status: expiryDate < TODAY ? "expired" : "expiring",
  };
}

describe("buildStockAlerts", () => {
  it("orders by urgency, then name", () => {
    const alerts = buildStockAlerts({
      lowStock: [low("Sugar", 2, 10), low("Atta", 0, 5)],
      batches: [batch("Milk", "2026-09-20"), batch("Curd", "2026-09-10")],
      today: TODAY,
      alertDays: 30,
    });
    expect(alerts.map((a) => [a.kind, a.name])).toEqual([
      ["out_of_stock", "Atta"],
      ["expired", "Curd"],
      ["low_stock", "Sugar"],
      ["expiring", "Milk"],
    ]);
    expect(alerts.map((a) => a.detail)).toEqual([
      "Out of stock (0 pcs)",
      "Batch B1: 4 pcs past expiry (2026-09-10)",
      "2 pcs left — reorder level 10",
      "Batch B1: 4 pcs expire in 4 days (2026-09-20)",
    ]);
  });

  it("raises nothing for a product with no reorder level and stock on the shelf", () => {
    expect(buildStockAlerts({ lowStock: [low("Rice", 5, 0)], batches: [], today: TODAY, alertDays: 30 })).toEqual([]);
  });

  it("drops batches outside the window or already empty", () => {
    const alerts = buildStockAlerts({
      lowStock: [],
      batches: [batch("Milk", "2026-12-31"), batch("Curd", "2026-09-01", 0), batch("Ghee", TODAY, 1, null)],
      today: TODAY,
      alertDays: 30,
    });
    expect(alerts.map((a) => a.detail)).toEqual(["1 pcs expire today (2026-09-16)"]);
  });
});

describe("buildStockAlerts — pack stock rollup", () => {
  function parentRow(qtyOnHand: number, reorderLevel: number, packStockQty: number): LowStockRow {
    return {
      productId: "p-Sugar",
      name: "Sugar",
      uom: "kg",
      qtyOnHand,
      reorderLevel,
      packStockQty,
      kind: qtyOnHand + packStockQty <= 0 ? "out_of_stock" : "low_stock",
    };
  }

  it("raises nothing when the rolled-up total covers a 0 reorder level", () => {
    expect(
      buildStockAlerts({ lowStock: [parentRow(0, 0, 20)], batches: [], today: TODAY, alertDays: 30 }),
    ).toEqual([]);
  });

  it("flags low stock using the rolled-up total against the reorder level", () => {
    const alerts = buildStockAlerts({ lowStock: [parentRow(0, 25, 20)], batches: [], today: TODAY, alertDays: 30 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "low_stock",
      detail: "20 kg left (0 kg loose + 20 kg in packs) — reorder level 25",
    });
  });

  it("flags out of stock when both loose and packed stock are empty", () => {
    const alerts = buildStockAlerts({ lowStock: [parentRow(0, 0, 0)], batches: [], today: TODAY, alertDays: 30 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "out_of_stock",
      detail: "Out of stock — 0 kg loose, 0 kg in packs",
    });
  });
});

describe("alertsSignature", () => {
  it("ignores figures and order, and changes when the set changes", () => {
    const a = buildStockAlerts({ lowStock: [low("Sugar", 2, 10)], batches: [], today: TODAY, alertDays: 30 });
    const b = buildStockAlerts({ lowStock: [low("Sugar", 1, 10)], batches: [], today: TODAY, alertDays: 30 });
    const c = buildStockAlerts({
      lowStock: [low("Sugar", 1, 10), low("Dal", 0, 0)],
      batches: [],
      today: TODAY,
      alertDays: 30,
    });
    expect(alertsSignature(a)).toBe(alertsSignature(b));
    expect(alertsSignature(c)).not.toBe(alertsSignature(b));
    expect(alertsSignature([...c].reverse())).toBe(alertsSignature(c));
    expect(alertsSignature([])).toBe("");
  });
});

describe("summarizeAlerts", () => {
  it("counts each kind", () => {
    const alerts = buildStockAlerts({
      lowStock: [low("Sugar", 2, 10), low("Dal", 3, 5), low("Oil", 1, 4)],
      batches: [batch("Milk", "2026-09-20")],
      today: TODAY,
      alertDays: 30,
    });
    expect(summarizeAlerts(alerts)).toBe("4 items need attention: 3 low stock, 1 expiring");
    expect(summarizeAlerts(alerts.slice(0, 1))).toBe("1 item needs attention: 1 low stock");
    expect(summarizeAlerts([])).toBe("");
  });
});
