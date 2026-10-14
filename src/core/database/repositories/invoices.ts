import { randomUUID } from "node:crypto";

import type { ExchangeReturnSummary, InvoiceData, ReceiptPrintFormat } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";

/**
 * Everything a receipt or a GST invoice prints, read from the saved bill — never from the
 * cart on screen, so a reprint matches what was charged.
 */
export async function getInvoiceData(db: Db, saleId: string): Promise<InvoiceData | undefined> {
  const sale = await db.selectFrom("sales").selectAll().where("id", "=", saleId).executeTakeFirst();
  if (!sale) return undefined;

  const store = await db
    .selectFrom("stores")
    .select(["name", "address", "gstin", "stateCode"])
    .where("id", "=", sale.storeId)
    .executeTakeFirst();

  const items = await db
    .selectFrom("saleItems as si")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("si.saleId", "=", saleId)
    .orderBy("si.lineNo")
    .select([
      "si.lineNo as lineNo",
      "si.productId as productId",
      "p.name as name",
      "p.nameTamil as nameTamil",
      "p.hsnCode as hsnCode",
      "p.uom as uom",
      "si.qty as qty",
      "si.unitPricePaise as unitPricePaise",
      "si.discountPaise as discountPaise",
      "si.taxablePaise as taxablePaise",
      "si.taxRatePercent as taxRatePercent",
      "si.cgstPaise as cgstPaise",
      "si.sgstPaise as sgstPaise",
      "si.lineTotalPaise as lineTotalPaise",
    ])
    .execute();

  const payments = await db
    .selectFrom("payments")
    .select(["mode", "amountPaise", "refNo", "tenderedPaise", "changeAction"])
    .where("saleId", "=", saleId)
    .orderBy("createdAt")
    .execute();

  const customer = sale.customerId
    ? await db
        .selectFrom("customers")
        .select(["name", "phone", "address"])
        .where("id", "=", sale.customerId)
        .executeTakeFirst()
    : undefined;

  const cashier = await db.selectFrom("users").select("displayName").where("id", "=", sale.userId).executeTakeFirst();

  // At most one return links forward to this sale (one exchange per bill, by construction —
  // see CartPanel's "at most one pending return per bill tab").
  const exchangeReturn = await getExchangeReturnSummary(db, saleId);

  return {
    sale,
    items,
    payments,
    customer: customer ?? null,
    cashierName: cashier?.displayName ?? null,
    store: {
      // A store row always exists for a sale (foreign key); the fallback only keeps the type honest.
      name: store?.name ?? "Store",
      address: store?.address ?? null,
      gstin: store?.gstin ?? null,
      stateCode: store?.stateCode ?? null,
    },
    exchangeReturn,
  };
}

/** The "RETURNED ITEMS" section for a sale that took back goods from an earlier bill (an
 * exchange), or null when this sale has no linked return. */
async function getExchangeReturnSummary(db: Db, saleId: string): Promise<ExchangeReturnSummary | null> {
  const ret = await db
    .selectFrom("saleReturns as r")
    .innerJoin("sales as o", "o.id", "r.saleId")
    .where("r.exchangeSaleId", "=", saleId)
    .select([
      "r.id as id",
      "r.returnNo as returnNo",
      "r.refundPaise as refundPaise",
      "r.roundOffPaise as roundOffPaise",
      "r.exchangePaise as exchangePaise",
      "r.refundMode as refundMode",
      "o.billNo as originalBillNo",
      "o.createdAt as originalBillDate",
    ])
    .executeTakeFirst();
  if (!ret) return null;

  const items = await db
    .selectFrom("saleReturnItems as ri")
    .innerJoin("products as p", "p.id", "ri.productId")
    .where("ri.returnId", "=", ret.id)
    .select(["p.name as name", "p.nameTamil as nameTamil", "p.uom as uom", "ri.qty as qty", "ri.lineTotalPaise as amountPaise"])
    .execute();

  return {
    returnNo: ret.returnNo,
    originalBillNo: ret.originalBillNo,
    originalBillDate: ret.originalBillDate,
    refundPaise: ret.refundPaise,
    roundOffPaise: ret.roundOffPaise,
    exchangePaise: ret.exchangePaise,
    payoutPaise: ret.refundPaise - ret.exchangePaise,
    payoutMode: ret.refundMode === "exchange" ? null : ret.refundMode,
    lines: items.map((i) => ({ name: i.name, nameTamil: i.nameTamil, qty: i.qty, uom: i.uom, amountPaise: i.amountPaise })),
  };
}

/**
 * Whether any receipt, invoice or PDF of this bill has been produced before. The main process
 * asks this — not the screen — to decide whether the next copy is stamped "DUPLICATE COPY".
 */
export async function hasBeenPrinted(db: Db, saleId: string): Promise<boolean> {
  const row = await db.selectFrom("receiptPrints").select("id").where("saleId", "=", saleId).executeTakeFirst();
  return row !== undefined;
}

/** Appends one print to the log. Pass the transaction the matching audit entry is written in. */
export async function recordReceiptPrint(
  db: Db,
  input: { storeId: string; saleId: string; format: ReceiptPrintFormat; userId: string | null },
): Promise<void> {
  await db
    .insertInto("receiptPrints")
    .values({
      id: randomUUID(),
      storeId: input.storeId,
      saleId: input.saleId,
      format: input.format,
      userId: input.userId,
    })
    .execute();
}

/**
 * Records a print that has already succeeded. A duplicate (any copy after the first) is
 * also audited as `receipt_reprinted`, in the same transaction — a reprinted bill is how a
 * paid receipt gets handed out twice, so it belongs in the log. The first print is only
 * recorded.
 */
export async function logSuccessfulPrint(
  db: Db,
  input: {
    storeId: string;
    saleId: string;
    billNo: string;
    format: ReceiptPrintFormat;
    userId: string;
    deviceId: string | null;
    duplicate: boolean;
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await recordReceiptPrint(trx, input);
    if (input.duplicate) {
      await appendAuditLog(trx, {
        storeId: input.storeId,
        userId: input.userId,
        deviceId: input.deviceId,
        action: "receipt_reprinted",
        tableName: "sales",
        recordId: input.saleId,
        oldValue: null,
        newValue: { billNo: input.billNo, format: input.format },
        reason: null,
      });
    }
  });
}
