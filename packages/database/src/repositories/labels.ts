import { randomUUID } from "node:crypto";

import type { LabelDefaults, RepackHistoryEntry } from "@pos/types";
import { sql } from "kysely";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";

const BARCODE_SEQ_KEY = "label_barcode_seq";
const MAX_SUGGESTED_COPIES = 500;

export class LabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelError";
  }
}

export interface LabelAudit {
  userId: string;
  deviceId: string | null;
}

/** Same format as @pos/business-logic's inStoreBarcode — duplicated rather than imported: this
 * package can't load business-logic at runtime (see stockBatches.ts). Keep the two in step. */
function inStoreBarcodeLocal(seq: number): string {
  return `2${String(seq).padStart(7, "0")}`;
}

/**
 * The barcode printed on this product's labels. A product that already has one uses its first
 * (alphabetical, as the Inventory screen lists them); otherwise the next free in-store code is
 * assigned and saved to the product so scanning it works at the till straight away.
 */
export async function ensureProductBarcode(
  db: Db,
  storeId: string,
  productId: string,
  audit: LabelAudit,
): Promise<{ barcode: string; assigned: boolean }> {
  return db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom("products")
      .select(["storeId", "name", "uom"])
      .where("id", "=", productId)
      .executeTakeFirst();
    if (!product || product.storeId !== storeId) throw new LabelError("That product could not be found.");

    const existing = await trx
      .selectFrom("productBarcodes")
      .select("barcode")
      .where("productId", "=", productId)
      .orderBy("barcode")
      .executeTakeFirst();
    if (existing) return { barcode: existing.barcode, assigned: false };

    const saved = await trx.selectFrom("appSettings").select("value").where("key", "=", BARCODE_SEQ_KEY).executeTakeFirst();
    let seq = Number.parseInt(saved?.value ?? "0", 10);
    if (!Number.isFinite(seq) || seq < 0) seq = 0;

    let barcode: string;
    for (;;) {
      seq += 1;
      barcode = inStoreBarcodeLocal(seq);
      const taken = await trx.selectFrom("productBarcodes").select("id").where("barcode", "=", barcode).executeTakeFirst();
      if (!taken) break;
    }

    await trx
      .insertInto("appSettings")
      .values({ key: BARCODE_SEQ_KEY, value: String(seq) })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: String(seq) }))
      .execute();
    await trx
      .insertInto("productBarcodes")
      .values({ id: randomUUID(), productId, barcode, uom: product.uom })
      .execute();

    await appendAuditLog(trx, {
      storeId,
      userId: audit.userId,
      deviceId: audit.deviceId,
      action: "barcode_assigned",
      tableName: "product_barcodes",
      recordId: productId,
      oldValue: null,
      newValue: { barcode, productName: product.name },
      reason: null,
    });
    return { barcode, assigned: true };
  });
}

/** Everything the label dialog starts with; nothing here is written. */
export async function getLabelDefaults(
  db: Db,
  storeId: string,
  productId: string,
  repackId: string | null,
): Promise<LabelDefaults> {
  const product = await db
    .selectFrom("products as p")
    .innerJoin("stores as s", "s.id", "p.storeId")
    .leftJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null))
    .leftJoin("inventory as inv", (join) => join.onRef("inv.productId", "=", "p.id").on("inv.storeId", "=", storeId))
    .where("p.id", "=", productId)
    .select([
      "p.storeId as storeId",
      "p.name as name",
      "p.uom as uom",
      "p.rackLocation as rackLocation",
      "s.name as storeName",
      "pp.mrpPaise as mrpPaise",
      "pp.salePricePaise as salePricePaise",
      "inv.qtyOnHand as qtyOnHand",
    ])
    .executeTakeFirst();
  if (!product || product.storeId !== storeId) throw new LabelError("That product could not be found.");

  const barcode = await db
    .selectFrom("productBarcodes")
    .select("barcode")
    .where("productId", "=", productId)
    .orderBy("barcode")
    .executeTakeFirst();

  const qtyOnHand = product.qtyOnHand ?? 0;
  const productMrp = product.mrpPaise ?? 0;
  let packedOn: string | null = null;
  let expiryDate: string | null = null;
  let mrpPaise = productMrp;
  let suggestedCopies = Math.min(MAX_SUGGESTED_COPIES, Math.max(0, Math.floor(qtyOnHand)));

  if (repackId) {
    const repack = await db
      .selectFrom("repacks")
      .select(["storeId", "childProductId", "packedOn", "expiryDate", "childQty"])
      .where("id", "=", repackId)
      .executeTakeFirst();
    if (!repack || repack.storeId !== storeId || repack.childProductId !== productId) {
      throw new LabelError("That repack could not be found.");
    }
    const batch = await db
      .selectFrom("stockBatches")
      .select("mrpPaise")
      .where("repackId", "=", repackId)
      .orderBy("createdAt")
      .executeTakeFirst();
    packedOn = repack.packedOn;
    expiryDate = repack.expiryDate;
    mrpPaise = batch?.mrpPaise ?? productMrp;
    suggestedCopies = Math.min(MAX_SUGGESTED_COPIES, Math.max(0, Math.floor(repack.childQty)));
  } else {
    const batch = await db
      .selectFrom("stockBatches")
      .select(["packedOn", "createdAt", "expiryDate", "mrpPaise"])
      .where("storeId", "=", storeId)
      .where("productId", "=", productId)
      .where("qtyRemaining", ">", 0)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();
    if (batch) {
      packedOn = batch.packedOn ?? batch.createdAt.slice(0, 10);
      expiryDate = batch.expiryDate;
      mrpPaise = batch.mrpPaise ?? productMrp;
    }
  }

  return {
    productName: product.name,
    storeName: product.storeName,
    barcode: barcode?.barcode ?? null,
    mrpPaise,
    salePricePaise: product.salePricePaise ?? 0,
    packedOn,
    expiryDate,
    rackLocation: product.rackLocation,
    qtyOnHand,
    uom: product.uom,
    suggestedCopies,
  };
}

export interface RecordLabelPrintInput {
  storeId: string;
  productId: string;
  repackId: string | null;
  labelCount: number;
  barcode: string;
  packedOn: string | null;
  expiryDate: string | null;
  mrpPaise: number;
  salePricePaise: number;
  userId: string;
}

/** Called only after the printer reported success, so the history never claims labels that didn't print. */
export async function recordLabelPrint(db: Db, input: RecordLabelPrintInput, audit: LabelAudit): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const product = await trx.selectFrom("products").select("name").where("id", "=", input.productId).executeTakeFirst();
    const repack = input.repackId
      ? await trx.selectFrom("repacks").select("batchNo").where("id", "=", input.repackId).executeTakeFirst()
      : undefined;

    await trx
      .insertInto("labelPrints")
      .values({
        id: randomUUID(),
        storeId: input.storeId,
        productId: input.productId,
        repackId: input.repackId,
        labelCount: input.labelCount,
        barcode: input.barcode,
        packedOn: input.packedOn,
        expiryDate: input.expiryDate,
        mrpPaise: input.mrpPaise,
        salePricePaise: input.salePricePaise,
        userId: input.userId,
      })
      .execute();

    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: audit.userId,
      deviceId: audit.deviceId,
      action: "labels_printed",
      tableName: "label_prints",
      recordId: input.productId,
      oldValue: null,
      newValue: {
        productName: product?.name ?? "",
        count: input.labelCount,
        barcode: input.barcode,
        packedOn: input.packedOn,
        expiryDate: input.expiryDate,
        ...(repack ? { batchNo: repack.batchNo } : {}),
      },
      reason: null,
    });
  });
}

/** Repacks where this product is the bulk parent or the pack made, newest first. */
export async function listRepackHistory(
  db: Db,
  storeId: string,
  productId: string,
  limit = 20,
): Promise<RepackHistoryEntry[]> {
  const rows = await db
    .selectFrom("repacks as r")
    .innerJoin("products as parent", "parent.id", "r.parentProductId")
    .innerJoin("products as child", "child.id", "r.childProductId")
    .innerJoin("users as u", "u.id", "r.userId")
    .where("r.storeId", "=", storeId)
    .where((eb) => eb.or([eb("r.parentProductId", "=", productId), eb("r.childProductId", "=", productId)]))
    .orderBy("r.createdAt", "desc")
    .orderBy(sql`r.rowid`, "desc")
    .limit(limit)
    .select([
      "r.id as repackId",
      "r.batchNo as batchNo",
      "r.createdAt as createdAt",
      "r.packedOn as packedOn",
      "r.expiryDate as expiryDate",
      "parent.name as parentName",
      "parent.uom as parentUom",
      "child.id as childProductId",
      "child.name as childName",
      "r.childQty as childQty",
      "r.parentQtyUsed as parentQtyUsed",
      "u.displayName as userName",
    ])
    .execute();
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.repackId);
  const printed = await db
    .selectFrom("labelPrints")
    .where("repackId", "in", ids)
    .groupBy("repackId")
    .select(["repackId"])
    .select((eb) => eb.fn.sum<number | null>("labelCount").as("total"))
    .execute();
  const printedByRepack = new Map(printed.map((p) => [p.repackId, Number(p.total ?? 0)]));

  const sourceRows = await db
    .selectFrom("repackSources as rs")
    .leftJoin("stockBatches as b", "b.id", "rs.parentBatchId")
    .where("rs.repackId", "in", ids)
    .select(["rs.repackId as repackId", "b.batchNo as batchNo", "rs.qty as qty", "rs.expiryDate as expiryDate"])
    .orderBy(sql`rs.rowid`)
    .execute();
  const sourcesByRepack = new Map<string, RepackHistoryEntry["sources"]>();
  for (const s of sourceRows) {
    if (!s.repackId) continue;
    const list = sourcesByRepack.get(s.repackId) ?? [];
    list.push({ batchNo: s.batchNo ?? null, qty: s.qty, expiryDate: s.expiryDate });
    sourcesByRepack.set(s.repackId, list);
  }

  return rows.map((r) => ({
    repackId: r.repackId,
    batchNo: r.batchNo,
    createdAt: r.createdAt,
    packedOn: r.packedOn,
    expiryDate: r.expiryDate,
    parentName: r.parentName,
    childProductId: r.childProductId,
    childName: r.childName,
    childQty: r.childQty,
    parentQtyUsed: r.parentQtyUsed,
    parentUom: r.parentUom,
    userName: r.userName,
    labelsPrinted: printedByRepack.get(r.repackId) ?? 0,
    sources: sourcesByRepack.get(r.repackId) ?? [],
  }));
}
