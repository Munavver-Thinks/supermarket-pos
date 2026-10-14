import { randomUUID } from "node:crypto";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { applyStockMovement, getStock } from "./inventory.js";
import { consumeForRepack, createBatch } from "./stockBatches.js";

/** Anything smaller is float drift, not a real shortfall — matches stockBatches.ts's EPSILON. */
const EPSILON = 1e-9;

export class RepackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepackError";
  }
}

export interface RepackInput {
  storeId: string;
  parentProductId: string;
  childProductId: string;
  /** How many of the child's own units to make, e.g. 20 for "make 20 packs of 1kg". */
  childQty: number;
  userId: string;
  deviceId: string | null;
  /** YYYY-MM-DD; decides which of the parent's batches count as expired. */
  today: string;
  /** YYYY-MM-DD the packs were made; not in the future. */
  packedOn: string;
  /** YYYY-MM-DD best-before entered by the user; the parent batch's own expiry wins if earlier. */
  expiryDate: string | null;
}

export interface RepackResult {
  parentQtyOnHandAfter: number;
  childQtyOnHandAfter: number;
  parentQtyUsed: number;
  repackId: string;
  batchNo: string;
}

/** The earlier of two optional dates; null means "no date", so it never beats a real one. */
function earlierExpiry(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/**
 * Converts stock of a bulk product into stock of one of its pack-size children — "make 20
 * packs of 1kg from Sugar 50kg Bag". One transaction: takes the parent's stock out (earliest
 * expiry first, same rule as a sale, but never from stock that has already expired — see
 * consumeForRepack) and receives the child's stock in, with a new batch per distinct expiry
 * drawn from, so the child's own expiry alerts stay accurate rather than collapsing to one
 * guess. Refuses rather than repacking partially if there isn't enough in-date stock.
 *
 * Also writes a `repacks` row (batch number RP-YYYYMMDD-n) and one `repack_sources` row per
 * draw, so any pack can be traced back to the bulk batch it came from.
 */
export async function repackStock(db: Db, input: RepackInput): Promise<RepackResult> {
  if (!(input.childQty > 0)) throw new RepackError("Enter how many to make.");
  if (input.packedOn > input.today) throw new RepackError("Packed on can't be a future date.");
  if (input.expiryDate !== null && input.expiryDate < input.packedOn) {
    throw new RepackError("Best before can't be earlier than the packed date.");
  }

  return db.transaction().execute(async (trx) => {
    const child = await trx
      .selectFrom("products")
      .select(["storeId", "name", "parentProductId", "packQty"])
      .where("id", "=", input.childProductId)
      .executeTakeFirst();
    if (!child || child.storeId !== input.storeId) throw new RepackError("That pack size could not be found.");
    if (child.parentProductId !== input.parentProductId || child.packQty === null) {
      throw new RepackError("That product is not a pack size of this one.");
    }

    const parent = await trx
      .selectFrom("products")
      .select(["storeId", "name"])
      .where("id", "=", input.parentProductId)
      .executeTakeFirst();
    if (!parent || parent.storeId !== input.storeId) throw new RepackError("That bulk product could not be found.");

    const childPrice = await trx
      .selectFrom("productPrices")
      .select(["costPricePaise", "mrpPaise"])
      .where("productId", "=", input.childProductId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();

    const parentQtyNeeded = input.childQty * child.packQty;
    const parentOnHandBefore = await getStock(trx, input.storeId, input.parentProductId);

    const draws = await consumeForRepack(trx, {
      storeId: input.storeId,
      productId: input.parentProductId,
      qty: parentQtyNeeded,
      onHandBefore: parentOnHandBefore,
      today: input.today,
    });
    const drawn = draws.reduce((sum, d) => sum + d.qty, 0);
    if (drawn < parentQtyNeeded - EPSILON) {
      const canMake = Math.floor((drawn / child.packQty) * 100) / 100;
      throw new RepackError(
        `Not enough in-date stock — only enough to make about ${canMake} of this pack. ` +
          `Some of ${parent.name}'s stock has already expired.`,
      );
    }

    const repackId = randomUUID();

    const sameDay = await trx
      .selectFrom("repacks")
      .where("storeId", "=", input.storeId)
      .where("packedOn", "=", input.packedOn)
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirst();
    const batchNo = `RP-${input.packedOn.replaceAll("-", "")}-${Number(sameDay?.n ?? 0) + 1}`;

    // The label shows one best-before for the whole run, so the repack keeps the earliest
    // effective date among the child batches.
    const childExpiries = draws.map((d) => earlierExpiry(input.expiryDate, d.expiryDate));
    const repackExpiry = childExpiries.reduce<string | null>((acc, e) => earlierExpiry(acc, e), null);

    await trx
      .insertInto("repacks")
      .values({
        id: repackId,
        storeId: input.storeId,
        parentProductId: input.parentProductId,
        childProductId: input.childProductId,
        childQty: input.childQty,
        parentQtyUsed: parentQtyNeeded,
        batchNo,
        packedOn: input.packedOn,
        expiryDate: repackExpiry,
        userId: input.userId,
      })
      .execute();

    await applyStockMovement(trx, {
      id: randomUUID(),
      storeId: input.storeId,
      productId: input.parentProductId,
      qtyChange: -parentQtyNeeded,
      reason: "repack_out",
      referenceType: "repack",
      referenceId: repackId,
      userId: input.userId,
    });

    await applyStockMovement(trx, {
      id: randomUUID(),
      storeId: input.storeId,
      productId: input.childProductId,
      qtyChange: input.childQty,
      reason: "repack_in",
      referenceType: "repack",
      referenceId: repackId,
      userId: input.userId,
    });

    // One child batch per distinct expiry drawn from, so a repack that spanned two parent
    // batches doesn't collapse two different expiry dates into one guess.
    for (const [i, draw] of draws.entries()) {
      await trx
        .insertInto("repackSources")
        .values({
          id: randomUUID(),
          repackId,
          parentBatchId: draw.batchId,
          qty: draw.qty,
          expiryDate: draw.expiryDate,
        })
        .execute();

      const childUnits = draw.qty / child.packQty;
      await createBatch(trx, {
        storeId: input.storeId,
        productId: input.childProductId,
        batchNo,
        expiryDate: childExpiries[i] ?? null,
        qtyReceived: childUnits,
        qtyRemaining: childUnits,
        costPricePaise: childPrice?.costPricePaise ?? 0,
        // The child's own current MRP — it's a different pack size with its own printed MRP,
        // not the parent's.
        mrpPaise: childPrice?.mrpPaise ?? null,
        purchaseId: null,
        packedOn: input.packedOn,
        repackId,
      });
    }

    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: "stock_repacked",
      tableName: "products",
      recordId: input.childProductId,
      oldValue: null,
      newValue: {
        parentName: parent.name,
        childName: child.name,
        parentQtyUsed: parentQtyNeeded,
        childQtyMade: input.childQty,
        batchNo,
        packedOn: input.packedOn,
        expiryDate: repackExpiry,
      },
      reason: null,
    });

    return {
      parentQtyOnHandAfter: await getStock(trx, input.storeId, input.parentProductId),
      childQtyOnHandAfter: await getStock(trx, input.storeId, input.childProductId),
      parentQtyUsed: parentQtyNeeded,
      repackId,
      batchNo,
    };
  });
}
