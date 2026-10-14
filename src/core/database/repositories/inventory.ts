import type { LowStockRow, StockMovementReason } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { consumeForSale, trimBatchesToOnHand } from "./stockBatches.js";

export async function getStock(db: Db, storeId: string, productId: string): Promise<number> {
  const row = await db
    .selectFrom("inventory")
    .select("qtyOnHand")
    .where("storeId", "=", storeId)
    .where("productId", "=", productId)
    .executeTakeFirst();
  return row?.qtyOnHand ?? 0;
}

/**
 * On-hand quantities for several products at once, keyed by product id. Every requested id
 * is present in the result — one with no inventory row reads as 0 — so a caller can tell
 * "has no stock" apart from "not looked up yet".
 */
export async function getStockLevels(db: Db, storeId: string, productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .selectFrom("inventory")
    .select(["productId", "qtyOnHand"])
    .where("storeId", "=", storeId)
    .where("productId", "in", productIds)
    .execute();
  const levels: Record<string, number> = Object.fromEntries(productIds.map((id) => [id, 0]));
  for (const row of rows) levels[row.productId] = row.qtyOnHand;
  return levels;
}

/** Local calendar day, only for callers that didn't pass one (this package can't load business-logic). */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Applies a stock movement and appends the ledger entry atomically. Must be called
 * within a transaction shared with whatever else the caller is doing (e.g. sale creation),
 * or on its own `db.transaction()` for standalone adjustments.
 *
 * This is the only place qty_on_hand changes, so it is also where batches are kept in step:
 * a sale draws from batches earliest-expiry first, any other decrease trims them back under
 * the new count, and an increase leaves them alone (the extra stock is untracked).
 */
export async function applyStockMovement(
  trx: Db,
  input: {
    id: string;
    storeId: string;
    productId: string;
    qtyChange: number;
    reason: StockMovementReason;
    referenceType: "sale" | "sale_return" | "purchase" | "stock_adjustment" | "manual" | "repack";
    referenceId: string;
    userId: string;
    /** YYYY-MM-DD; decides which batches count as expired when a sale draws from them. */
    expiryToday?: string | undefined;
  },
): Promise<void> {
  const existing = await trx
    .selectFrom("inventory")
    .select("qtyOnHand")
    .where("storeId", "=", input.storeId)
    .where("productId", "=", input.productId)
    .executeTakeFirst();

  if (existing) {
    await trx
      .updateTable("inventory")
      .set((eb) => ({
        qtyOnHand: eb("qtyOnHand", "+", input.qtyChange),
        updatedAt: new Date().toISOString(),
      }))
      .where("storeId", "=", input.storeId)
      .where("productId", "=", input.productId)
      .execute();
  } else {
    await trx
      .insertInto("inventory")
      .values({
        storeId: input.storeId,
        productId: input.productId,
        qtyOnHand: input.qtyChange,
        reorderLevel: 0,
      })
      .execute();
  }

  await trx
    .insertInto("stockLedger")
    .values({
      id: input.id,
      storeId: input.storeId,
      productId: input.productId,
      qtyChange: input.qtyChange,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: input.userId,
    })
    .execute();

  if (input.qtyChange < 0) {
    if (input.reason === "sale") {
      await consumeForSale(trx, {
        storeId: input.storeId,
        productId: input.productId,
        qty: -input.qtyChange,
        onHandBefore: existing?.qtyOnHand ?? 0,
        today: input.expiryToday ?? localToday(),
      });
    }
    // For a sale this is a safety net and normally does nothing; for every other decrease it
    // is what keeps the batches from claiming more than the shelf holds.
    await trimBatchesToOnHand(trx, input.storeId, input.productId);
  }
}

export async function recordStockAdjustment(
  db: Db,
  input: {
    id: string;
    ledgerId: string;
    storeId: string;
    productId: string;
    qtyAfter: number;
    reason: Extract<
      StockMovementReason,
      | "manual_stock_in"
      | "adjustment_damaged"
      | "adjustment_missing"
      | "adjustment_correction"
      | "adjustment_expired"
    >;
    note: string | null;
    userId: string;
    /** The manager or owner who approved it — the actor themselves when their role needs no approval. */
    approvedByUserId: string | null;
    /** Recorded on the audit entry. */
    deviceId?: string | null | undefined;
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const qtyBefore = await getStock(trx, input.storeId, input.productId);
    const qtyChange = input.qtyAfter - qtyBefore;

    await trx
      .insertInto("stockAdjustments")
      .values({
        id: input.id,
        storeId: input.storeId,
        productId: input.productId,
        qtyBefore,
        qtyAfter: input.qtyAfter,
        reason: input.reason,
        note: input.note,
        userId: input.userId,
        approvedByUserId: input.approvedByUserId,
      })
      .execute();

    await applyStockMovement(trx, {
      id: input.ledgerId,
      storeId: input.storeId,
      productId: input.productId,
      qtyChange,
      reason: input.reason,
      referenceType: "stock_adjustment",
      referenceId: input.id,
      userId: input.userId,
    });

    // The count before is read inside this transaction, so the entry shows what the shelf
    // was recorded at when the correction was made — not just what it was changed to.
    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      action: "stock_adjustment",
      tableName: "inventory",
      recordId: input.productId,
      oldValue: { qtyOnHand: qtyBefore },
      newValue: { qtyOnHand: input.qtyAfter, reason: input.reason, approvedByUserId: input.approvedByUserId },
      reason: input.note,
    });
  });
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Stock held in pack sizes, per parent, in the parent's own uom — Σ child.qtyOnHand ×
 * child.packQty. Deliberately counts EVERY child row: unlinked (price-linking is unrelated to
 * stock), inactive (deactivating only hides from billing, doesn't write off stock), and a
 * negative qty (oversold packs) is summed as-is, not clamped to 0 — that's the true total. A
 * parent with at least one child always gets an entry, even if the sum works out to 0.
 *
 * This is the database twin of @pos/business-logic's `sumPackStock`, duplicated rather than
 * shared because this package can't import business-logic at runtime (see stockBatches.ts) —
 * keep both in step.
 */
export async function getPackStockByParent(db: Db, storeId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("products as c")
    .leftJoin("inventory as ci", (join) => join.onRef("ci.productId", "=", "c.id").on("ci.storeId", "=", storeId))
    .where("c.storeId", "=", storeId)
    .where("c.parentProductId", "is not", null)
    .select(["c.parentProductId as parentProductId", "c.packQty as packQty", "ci.qtyOnHand as qtyOnHand"])
    .execute();

  const totals = new Map<string, number>();
  for (const row of rows) {
    const parentId = row.parentProductId;
    if (!parentId) continue; // Excluded by the where clause; narrows the type.
    const contribution = (row.qtyOnHand ?? 0) * (row.packQty ?? 0);
    totals.set(parentId, (totals.get(parentId) ?? 0) + contribution);
  }
  for (const [parentId, total] of totals) totals.set(parentId, round3(total));
  return totals;
}

/** Each bulk product's pack sizes with what is on hand of each (active or not), biggest pack first. */
export async function getPackBreakdownByParent(
  db: Db,
  storeId: string,
): Promise<Map<string, Array<{ name: string; packQty: number; qtyOnHand: number }>>> {
  const rows = await db
    .selectFrom("products as c")
    .leftJoin("inventory as ci", (join) => join.onRef("ci.productId", "=", "c.id").on("ci.storeId", "=", storeId))
    .where("c.storeId", "=", storeId)
    .where("c.parentProductId", "is not", null)
    .orderBy("c.packQty", "desc")
    .orderBy("c.name", "asc")
    .select(["c.parentProductId as parentProductId", "c.name as name", "c.packQty as packQty", "ci.qtyOnHand as qtyOnHand"])
    .execute();

  const byParent = new Map<string, Array<{ name: string; packQty: number; qtyOnHand: number }>>();
  for (const row of rows) {
    if (!row.parentProductId) continue;
    const list = byParent.get(row.parentProductId) ?? [];
    list.push({ name: row.name, packQty: row.packQty ?? 0, qtyOnHand: row.qtyOnHand ?? 0 });
    byParent.set(row.parentProductId, list);
  }
  return byParent;
}

/**
 * Active products that need restocking. One definition shared by the Inventory list, the
 * dashboard count and the alerts, so the three never disagree:
 *  - out_of_stock: total stock ≤ 0, whatever the reorder level;
 *  - low_stock: a reorder level is set and 0 < total ≤ that level.
 * For a bulk product with pack sizes (any product with ≥1 child), "total" is its own qty plus
 * everything sitting in its pack sizes (see getPackStockByParent) — the parent's reorder level
 * answers "do we need to buy more," and packs already made are stock already owned. A pack-size
 * child, and any ordinary product with no children, uses its own qty unchanged (packStockQty is
 * null for those, so total === qtyOnHand). A product with no reorder level and stock on the
 * shelf raises nothing.
 *
 * Filtering and sorting happen in JS, not SQL, since the kind/order decision now depends on the
 * rolled-up total rather than a plain column. A full scan of a store's active inventory rows per
 * call is fine at this app's scale (a small single-store shop, at most a few thousand products).
 */
export async function getLowStock(db: Db, storeId: string): Promise<LowStockRow[]> {
  const rows = await db
    .selectFrom("inventory as inv")
    .innerJoin("products as p", "p.id", "inv.productId")
    .where("inv.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .select([
      "p.id as productId",
      "p.name as name",
      "p.uom as uom",
      "inv.qtyOnHand as qtyOnHand",
      "inv.reorderLevel as reorderLevel",
    ])
    .execute();

  const packStockByParent = await getPackStockByParent(db, storeId);

  const candidates: Array<LowStockRow & { total: number }> = [];
  for (const row of rows) {
    const packStockQty = packStockByParent.get(row.productId) ?? null;
    const total = round3(row.qtyOnHand + (packStockQty ?? 0));
    const kind: LowStockRow["kind"] | null =
      total <= 0 ? "out_of_stock" : row.reorderLevel > 0 && total <= row.reorderLevel ? "low_stock" : null;
    if (kind === null) continue;
    candidates.push({
      productId: row.productId,
      name: row.name,
      uom: row.uom,
      qtyOnHand: row.qtyOnHand,
      reorderLevel: row.reorderLevel,
      packStockQty,
      kind,
      total,
    });
  }

  return candidates
    .sort((a, b) => a.total - b.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ total: _total, ...r }) => r);
}

/**
 * Sets a product's reorder level without touching its count. Creates the inventory row at
 * zero if the product somehow has none — no ledger entry, since no stock moved.
 */
export async function setReorderLevel(trx: Db, storeId: string, productId: string, reorderLevel: number): Promise<void> {
  await trx
    .insertInto("inventory")
    .values({ storeId, productId, qtyOnHand: 0, reorderLevel })
    .onConflict((oc) =>
      oc.columns(["productId", "storeId"]).doUpdateSet({ reorderLevel, updatedAt: new Date().toISOString() }),
    )
    .execute();
}
