import { randomUUID } from "node:crypto";

import type { ExpiringBatchRow, StockBatch } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { applyStockMovement, getStock, getStockLevels } from "./inventory.js";

/**
 * Batches are a breakdown of on-hand stock, never a second count. The rule every function
 * here keeps: for each product, the sum of qty_remaining never exceeds max(qty_on_hand, 0).
 * inventory.qty_on_hand still changes only through applyStockMovement; these functions only
 * decide which batches a change came out of.
 *
 * Dates are local calendar days (YYYY-MM-DD) supplied by the caller — this package doesn't
 * load business-logic at runtime, so "today" is always passed in.
 */

/** Anything smaller is float drift from weighed quantities, not stock. */
const EPSILON = 1e-9;

export class BatchWriteOffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchWriteOffError";
  }
}

export async function createBatch(
  trx: Db,
  input: {
    storeId: string;
    productId: string;
    batchNo: string | null;
    expiryDate: string | null;
    qtyReceived: number;
    qtyRemaining: number;
    costPricePaise: number;
    mrpPaise: number | null;
    purchaseId: string | null;
    packedOn?: string | null | undefined;
    repackId?: string | null | undefined;
  },
): Promise<string> {
  const id = randomUUID();
  await trx
    .insertInto("stockBatches")
    .values({
      id,
      storeId: input.storeId,
      productId: input.productId,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate,
      qtyReceived: input.qtyReceived,
      qtyRemaining: Math.max(0, input.qtyRemaining),
      costPricePaise: input.costPricePaise,
      mrpPaise: input.mrpPaise,
      purchaseId: input.purchaseId,
      packedOn: input.packedOn ?? null,
      repackId: input.repackId ?? null,
    })
    .execute();
  return id;
}

/** Total still held in batches for one product. */
export async function sumRemaining(trx: Db, storeId: string, productId: string): Promise<number> {
  const row = await trx
    .selectFrom("stockBatches")
    .where("storeId", "=", storeId)
    .where("productId", "=", productId)
    .where("qtyRemaining", ">", 0)
    .select((eb) => eb.fn.sum<number | null>("qtyRemaining").as("total"))
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

/**
 * Pins stock that arrived without a batch to the MRP that was in force right before this
 * receipt changes it — otherwise old untracked stock would silently inherit the new MRP.
 */
export async function trackUntrackedStock(
  trx: Db,
  input: { storeId: string; productId: string; onHand: number; costPricePaise: number; mrpPaise: number },
): Promise<void> {
  const untracked = Math.max(input.onHand, 0) - (await sumRemaining(trx, input.storeId, input.productId));
  if (untracked <= EPSILON) return;
  await createBatch(trx, {
    storeId: input.storeId,
    productId: input.productId,
    batchNo: null,
    expiryDate: null,
    qtyReceived: untracked,
    qtyRemaining: untracked,
    costPricePaise: input.costPricePaise,
    mrpPaise: input.mrpPaise,
    purchaseId: null,
  });
}

async function openBatches(trx: Db, storeId: string, productId: string) {
  return trx
    .selectFrom("stockBatches")
    .select(["id", "expiryDate", "qtyRemaining", "createdAt", "mrpPaise"])
    .where("storeId", "=", storeId)
    .where("productId", "=", productId)
    .where("qtyRemaining", ">", 0)
    .execute();
}

type OpenBatch = Awaited<ReturnType<typeof openBatches>>[number];

/** Earliest expiry first, undated batches last, then oldest arrival. */
function byExpiryThenAge(a: OpenBatch, b: OpenBatch): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

async function setRemaining(trx: Db, batchId: string, qtyRemaining: number): Promise<void> {
  await trx
    .updateTable("stockBatches")
    .set({ qtyRemaining: qtyRemaining < EPSILON ? 0 : qtyRemaining })
    .where("id", "=", batchId)
    .execute();
}

/** Takes up to `qty` out of the batches in the order given; returns how much was taken. */
async function drawFrom(trx: Db, batches: OpenBatch[], qty: number): Promise<number> {
  let left = qty;
  for (const batch of batches) {
    if (left <= EPSILON) break;
    const take = Math.min(batch.qtyRemaining, left);
    await setRemaining(trx, batch.id, batch.qtyRemaining - take);
    left -= take;
  }
  return qty - left;
}

/**
 * Decides which batches a sale came out of, for a product whose on-hand count is being
 * lowered by `qty` in the same transaction:
 *  1. batches still in date, earliest expiry first (undated last), then oldest arrival;
 *  2. then stock that isn't in any batch (older purchases, returns, counted-in stock);
 *  3. only then expired batches, oldest first.
 * Selling more than is recorded simply empties everything — this never throws, because a
 * shortfall is the negative-stock policy's decision, not this function's.
 */
export async function consumeForSale(
  trx: Db,
  input: { storeId: string; productId: string; qty: number; onHandBefore: number; today: string },
): Promise<void> {
  if (input.qty <= EPSILON) return;
  const batches = await openBatches(trx, input.storeId, input.productId);
  if (batches.length === 0) return;

  const inDate = batches.filter((b) => b.expiryDate === null || b.expiryDate >= input.today).sort(byExpiryThenAge);
  const expired = batches.filter((b) => b.expiryDate !== null && b.expiryDate < input.today).sort(byExpiryThenAge);
  const tracked = batches.reduce((sum, b) => sum + b.qtyRemaining, 0);
  const untracked = Math.max(0, input.onHandBefore - tracked);

  let left = input.qty;
  left -= await drawFrom(trx, inDate, left);
  left -= Math.min(untracked, left);
  if (left > EPSILON) await drawFrom(trx, expired, left);
}

/**
 * The read-only twin of consumeForSale: same filtering/sorting (in-date batches via
 * byExpiryThenAge, then the untracked pool, then expired as a last resort) but it never
 * calls setRemaining or mutates anything. Must be kept in step with consumeForSale's ordering.
 *
 * Each unit of qty drawn contributes an MRP — from a batch, its own mrpPaise or (when null)
 * the product's current MRP; from the untracked portion, or from any shortfall beyond
 * everything tracked (overselling), the product's current MRP. Returns the lowest of all
 * contributed MRPs that are > 0, or null when there are none (e.g. qty is 0/negative, or
 * every contributing MRP is 0/unset).
 */
export async function previewMrpCap(
  db: Db,
  input: {
    storeId: string;
    productId: string;
    qty: number;
    onHandBefore: number;
    today: string;
    productMrpPaise: number;
  },
): Promise<number | null> {
  if (input.qty <= EPSILON) return null;
  const batches = await openBatches(db, input.storeId, input.productId);

  const inDate = batches.filter((b) => b.expiryDate === null || b.expiryDate >= input.today).sort(byExpiryThenAge);
  const expired = batches.filter((b) => b.expiryDate !== null && b.expiryDate < input.today).sort(byExpiryThenAge);
  const tracked = batches.reduce((sum, b) => sum + b.qtyRemaining, 0);
  const untracked = Math.max(0, input.onHandBefore - tracked);

  let left = input.qty;
  let minMrp: number | null = null;
  const consider = (mrpPaise: number): void => {
    if (mrpPaise > 0 && (minMrp === null || mrpPaise < minMrp)) minMrp = mrpPaise;
  };

  for (const batch of inDate) {
    if (left <= EPSILON) break;
    const take = Math.min(batch.qtyRemaining, left);
    if (take > EPSILON) {
      consider(batch.mrpPaise ?? input.productMrpPaise);
      left -= take;
    }
  }
  if (left > EPSILON && untracked > EPSILON) {
    const take = Math.min(untracked, left);
    if (take > EPSILON) {
      consider(input.productMrpPaise);
      left -= take;
    }
  }
  for (const batch of expired) {
    if (left <= EPSILON) break;
    const take = Math.min(batch.qtyRemaining, left);
    if (take > EPSILON) {
      consider(batch.mrpPaise ?? input.productMrpPaise);
      left -= take;
    }
  }
  // Anything still left is a shortfall beyond everything tracked (overselling).
  if (left > EPSILON) consider(input.productMrpPaise);

  return minMrp;
}

/**
 * MRP caps for a sale about to happen, one entry per product that needs one. Quantities are
 * summed per product first (a product can appear on more than one cart line) before the cap
 * is worked out from its on-hand batches and current MRP. A product absent from the result
 * has no cap known or needed.
 */
export async function getMrpCapsForSale(
  db: Db,
  storeId: string,
  lines: Array<{ productId: string; qty: number }>,
  today: string,
): Promise<Record<string, number>> {
  const qtyByProduct = new Map<string, number>();
  for (const line of lines) {
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  }
  const productIds = [...qtyByProduct.keys()];
  if (productIds.length === 0) return {};

  const onHand = await getStockLevels(db, storeId, productIds);
  const priceRows = await db
    .selectFrom("productPrices")
    .select(["productId", "mrpPaise"])
    .where("productId", "in", productIds)
    .where("effectiveTo", "is", null)
    .execute();
  const mrpByProduct = new Map(priceRows.map((r) => [r.productId, r.mrpPaise]));

  const result: Record<string, number> = {};
  for (const productId of productIds) {
    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: qtyByProduct.get(productId) ?? 0,
      onHandBefore: onHand[productId] ?? 0,
      today,
      productMrpPaise: mrpByProduct.get(productId) ?? 0,
    });
    if (cap !== null) result[productId] = cap;
  }
  return result;
}

/** Takes up to `qty` out of the batches in order, recording what came from where. */
async function drawFromRecording(
  trx: Db,
  batches: OpenBatch[],
  qty: number,
  into: Array<{ batchId: string | null; qty: number; expiryDate: string | null }>,
): Promise<number> {
  let left = qty;
  for (const batch of batches) {
    if (left <= EPSILON) break;
    const take = Math.min(batch.qtyRemaining, left);
    if (take > EPSILON) {
      await setRemaining(trx, batch.id, batch.qtyRemaining - take);
      into.push({ batchId: batch.id, qty: take, expiryDate: batch.expiryDate });
      left -= take;
    }
  }
  return qty - left;
}

/**
 * Decides which batches a repack came out of, same ordering as a sale (earliest expiry
 * first, then untracked stock) but with one deliberate difference: it never draws from an
 * expired batch. Repacking expired bulk stock into fresh-looking child packs would hide an
 * expiry a sale is required to respect, so this returns less than asked for rather than
 * reaching into expired stock — it is the caller's job to refuse the repack when that
 * happens, not this function's to quietly go along with it.
 *
 * Returns one entry per batch (or one untracked entry) actually drawn from, so the caller can
 * give each resulting child batch the correct expiry date rather than collapsing them into
 * a single guess.
 */
export async function consumeForRepack(
  trx: Db,
  input: { storeId: string; productId: string; qty: number; onHandBefore: number; today: string },
): Promise<Array<{ batchId: string | null; qty: number; expiryDate: string | null }>> {
  const draws: Array<{ batchId: string | null; qty: number; expiryDate: string | null }> = [];
  if (input.qty <= EPSILON) return draws;

  const batches = await openBatches(trx, input.storeId, input.productId);
  const inDate = batches.filter((b) => b.expiryDate === null || b.expiryDate >= input.today).sort(byExpiryThenAge);
  const tracked = batches.reduce((sum, b) => sum + b.qtyRemaining, 0);
  const untracked = Math.max(0, input.onHandBefore - tracked);

  let left = input.qty;
  left -= await drawFromRecording(trx, inDate, left, draws);
  if (left > EPSILON && untracked > EPSILON) {
    const take = Math.min(untracked, left);
    draws.push({ batchId: null, qty: take, expiryDate: null });
  }
  return draws;
}

/**
 * Brings the batches back under the on-hand count after any decrease that isn't a sale
 * (a damaged-stock correction, a write-off, a count that came in low). The excess is taken
 * from expired stock first, then the earliest expiry, then undated batches — the order in
 * which stock most plausibly went missing. A no-op when the batches already fit.
 */
export async function trimBatchesToOnHand(trx: Db, storeId: string, productId: string): Promise<void> {
  const batches = await openBatches(trx, storeId, productId);
  if (batches.length === 0) return;
  const allowed = Math.max(0, await getStock(trx, storeId, productId));
  const tracked = batches.reduce((sum, b) => sum + b.qtyRemaining, 0);
  const excess = tracked - allowed;
  if (excess <= EPSILON) return;
  // Expired batches have the earliest dates, so one expiry-ordered pass covers all three steps.
  await drawFrom(trx, batches.sort(byExpiryThenAge), excess);
}

/**
 * Expired quantity per product. Not capped at on-hand — the billing rule compares both
 * figures itself. Products with nothing expired are absent.
 */
export async function getExpiredQtyByProduct(
  trx: Db,
  storeId: string,
  productIds: string[],
  today: string,
): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const rows = await trx
    .selectFrom("stockBatches")
    .where("storeId", "=", storeId)
    .where("productId", "in", productIds)
    .where("qtyRemaining", ">", 0)
    .where("expiryDate", "is not", null)
    .where("expiryDate", "<", today)
    .groupBy("productId")
    .select(["productId"])
    .select((eb) => eb.fn.sum<number | null>("qtyRemaining").as("qty"))
    .execute();
  const result: Record<string, number> = {};
  for (const row of rows) result[row.productId] = Number(row.qty ?? 0);
  return result;
}

/** YYYY-MM-DD plus whole days, in UTC so a DST change can't skip a day. */
function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Batches of active products with stock left that have expired, or will within `withinDays`
 * of `today`. Most urgent first.
 */
export async function listExpiring(
  db: Db,
  storeId: string,
  today: string,
  withinDays: number,
): Promise<ExpiringBatchRow[]> {
  const rows = await db
    .selectFrom("stockBatches as b")
    .innerJoin("products as p", "p.id", "b.productId")
    .where("b.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .where("b.qtyRemaining", ">", 0)
    .where("b.expiryDate", "is not", null)
    .where("b.expiryDate", "<=", addDays(today, withinDays))
    .orderBy("b.expiryDate", "asc")
    .orderBy("p.name", "asc")
    .select([
      "b.id as batchId",
      "b.productId as productId",
      "p.name as productName",
      "p.uom as uom",
      "b.batchNo as batchNo",
      "b.expiryDate as expiryDate",
      "b.qtyRemaining as qtyRemaining",
      "b.costPricePaise as costPricePaise",
    ])
    .execute();

  return rows.map((r) => {
    const expiryDate = r.expiryDate ?? today;
    return {
      ...r,
      expiryDate,
      valuePaise: Math.round(r.costPricePaise * r.qtyRemaining),
      status: expiryDate < today ? ("expired" as const) : ("expiring" as const),
    };
  });
}

/** Every batch a product has had, newest first — including emptied ones, so the history reads. */
export async function listForProduct(db: Db, storeId: string, productId: string): Promise<StockBatch[]> {
  return db
    .selectFrom("stockBatches")
    .selectAll()
    .where("storeId", "=", storeId)
    .where("productId", "=", productId)
    .orderBy("createdAt", "desc")
    .execute();
}

export async function getBatch(db: Db, batchId: string): Promise<StockBatch | undefined> {
  return db.selectFrom("stockBatches").selectAll().where("id", "=", batchId).executeTakeFirst();
}

/**
 * Takes what is left of a batch off the shelf count, as its own adjustment. The batch is
 * zeroed before the stock movement so the trim that follows the decrease has nothing of
 * this batch left to touch. A batch that is already empty is refused and nothing is written
 * — clicking Write off twice must not take the stock down twice.
 */
export async function writeOffBatch(
  db: Db,
  input: {
    batchId: string;
    storeId: string;
    userId: string;
    approvedByUserId: string | null;
    deviceId: string | null;
    note: string | null;
  },
): Promise<{ productId: string; qty: number; qtyOnHandBefore: number; qtyOnHandAfter: number }> {
  return db.transaction().execute(async (trx) => {
    const batch = await trx
      .selectFrom("stockBatches")
      .selectAll()
      .where("id", "=", input.batchId)
      .executeTakeFirst();
    if (!batch || batch.storeId !== input.storeId) {
      throw new BatchWriteOffError("That batch could not be found.");
    }
    if (batch.qtyRemaining <= EPSILON) {
      throw new BatchWriteOffError("This batch has already been written off.");
    }

    const qtyOnHandBefore = await getStock(trx, input.storeId, batch.productId);
    // Never take the count below zero for a batch the shelf no longer fully holds.
    const qty = Math.min(batch.qtyRemaining, Math.max(qtyOnHandBefore, 0));
    const qtyOnHandAfter = qtyOnHandBefore - qty;
    const adjustmentId = randomUUID();

    await setRemaining(trx, batch.id, 0);

    await trx
      .insertInto("stockAdjustments")
      .values({
        id: adjustmentId,
        storeId: input.storeId,
        productId: batch.productId,
        qtyBefore: qtyOnHandBefore,
        qtyAfter: qtyOnHandAfter,
        reason: "adjustment_expired",
        note: input.note,
        userId: input.userId,
        approvedByUserId: input.approvedByUserId,
      })
      .execute();

    if (qty > EPSILON) {
      await applyStockMovement(trx, {
        id: randomUUID(),
        storeId: input.storeId,
        productId: batch.productId,
        qtyChange: -qty,
        reason: "adjustment_expired",
        referenceType: "stock_adjustment",
        referenceId: adjustmentId,
        userId: input.userId,
      });
    }

    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: "batch_written_off",
      tableName: "stock_batches",
      recordId: batch.id,
      oldValue: { qtyRemaining: batch.qtyRemaining },
      newValue: {
        productId: batch.productId,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        qty,
        qtyOnHandBefore,
        qtyOnHandAfter,
        approvedByUserId: input.approvedByUserId,
      },
      reason: input.note,
    });

    return { productId: batch.productId, qty, qtyOnHandBefore, qtyOnHandAfter };
  });
}
