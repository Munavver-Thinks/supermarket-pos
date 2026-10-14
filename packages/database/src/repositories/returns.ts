import { randomUUID } from "node:crypto";

import type { ReturnLineTotal, ReturnTotals } from "@pos/business-logic";
import type { RecentReturn, RefundMode, ReturnableLine, ReturnableSale, SaleReturn } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { nextBillNumber } from "./billNumber.js";
import { applyStockMovement } from "./inventory.js";

export class RefundToKhataWithoutCustomerError extends Error {
  constructor() {
    super("Refunding to khata needs a customer on the original bill.");
    this.name = "RefundToKhataWithoutCustomerError";
  }
}

/**
 * Two counters can look up the same bill and both start a return before either writes. The
 * per-request totals are computed from a read before the transaction, so the in-transaction
 * re-check in writeReturnInTrx is what actually closes that race; this is what it throws.
 */
export class ReturnNoLongerAvailableError extends Error {
  constructor() {
    super("Some of these items were already returned (perhaps from another counter). Look the bill up again.");
    this.name = "ReturnNoLongerAvailableError";
  }
}

/**
 * Returns get their own gap-free sequence per counter. The bill sequence is keyed by
 * counter, so returns borrow a suffixed key rather than a second table — the same
 * never-reused guarantee, in a separate run of numbers from the bills.
 */
function returnSequenceKey(counterId: string): string {
  return `${counterId}:returns`;
}

/** Looks up a bill for return by its printed number, with how much of each line has already come back. */
export async function getReturnableSale(db: Db, storeId: string, billNo: string): Promise<ReturnableSale | undefined> {
  return findReturnable(db, storeId, { billNo });
}

/**
 * The same lookup by sale id. The create handler re-reads the bill this way rather than
 * trusting the figures the renderer sends back.
 */
export async function getReturnableSaleById(
  db: Db,
  storeId: string,
  saleId: string,
): Promise<ReturnableSale | undefined> {
  return findReturnable(db, storeId, { saleId });
}

async function findReturnable(
  db: Db,
  storeId: string,
  by: { billNo: string } | { saleId: string },
): Promise<ReturnableSale | undefined> {
  let query = db
    .selectFrom("sales as s")
    .leftJoin("customers as c", "c.id", "s.customerId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed");

  query = "billNo" in by ? query.where("s.billNo", "=", by.billNo) : query.where("s.id", "=", by.saleId);

  const sale = await query
    .select([
      "s.id as id",
      "s.billNo as billNo",
      "s.createdAt as createdAt",
      "s.netPaise as netPaise",
      "s.customerId as customerId",
      "c.name as customerName",
    ])
    .executeTakeFirst();

  if (!sale) return undefined;

  const creditPayment = await db
    .selectFrom("payments")
    .select("id")
    .where("saleId", "=", sale.id)
    .where("mode", "=", "credit")
    .executeTakeFirst();

  const items = await db
    .selectFrom("saleItems as si")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("si.saleId", "=", sale.id)
    .orderBy("si.lineNo")
    .select([
      "si.id as saleItemId",
      "si.productId as productId",
      "si.qty as soldQty",
      "si.unitPricePaise as unitPricePaise",
      "si.discountPaise as discountPaise",
      "si.taxablePaise as taxablePaise",
      "si.cgstPaise as cgstPaise",
      "si.sgstPaise as sgstPaise",
      "si.lineTotalPaise as lineTotalPaise",
      "p.name as productName",
      "p.uom as uom",
    ])
    .execute();

  const returnedRows =
    items.length === 0
      ? []
      : await db
          .selectFrom("saleReturnItems")
          .select("saleItemId")
          .select((eb) => eb.fn.sum<number | null>("qty").as("qty"))
          .where(
            "saleItemId",
            "in",
            items.map((i) => i.saleItemId),
          )
          .groupBy("saleItemId")
          .execute();

  const returnedByItem = new Map(returnedRows.map((r) => [r.saleItemId, Number(r.qty ?? 0)]));

  const lines: ReturnableLine[] = items.map((i) => {
    const alreadyReturnedQty = returnedByItem.get(i.saleItemId) ?? 0;
    return {
      saleItemId: i.saleItemId,
      productId: i.productId,
      productName: i.productName,
      uom: i.uom,
      soldQty: i.soldQty,
      alreadyReturnedQty,
      returnableQty: Math.max(0, i.soldQty - alreadyReturnedQty),
      unitPricePaise: i.unitPricePaise,
      discountPaise: i.discountPaise,
      taxablePaise: i.taxablePaise,
      cgstPaise: i.cgstPaise,
      sgstPaise: i.sgstPaise,
      lineTotalPaise: i.lineTotalPaise,
    };
  });

  return {
    saleId: sale.id,
    billNo: sale.billNo,
    createdAt: sale.createdAt,
    netPaise: sale.netPaise,
    customerId: sale.customerId,
    customerName: sale.customerName,
    hadCreditPayment: creditPayment !== undefined,
    lines,
  };
}

export interface CreateReturnInput {
  storeId: string;
  counterId: string;
  returnNoPrefix: string;
  saleId: string;
  customerId: string | null;
  clientTxnId: string;
  userId: string;
  reason: string | null;
  refundMode: RefundMode;
  lines: ReturnLineTotal[];
  totals: ReturnTotals;
  /** Recorded on the audit entry. */
  deviceId?: string | null | undefined;
  /**
   * The manager or owner who signed off the refund (the actor themselves when they may
   * approve). Optional only so older callers keep compiling; the returns handler always sets it.
   */
  approvedByUserId?: string | null | undefined;
}

export interface CreateReturnResult {
  saleReturn: SaleReturn;
  alreadyExisted: boolean;
}

/**
 * Records a return: the credit note, its lines, the stock coming back, and — when the
 * refund goes to khata — the ledger entry reducing what the customer owes. All in one
 * transaction, so goods never come back on the shelf without the refund being recorded.
 *
 * Idempotent on clientTxnId, like createSale: a retried click returns the original credit
 * note rather than restocking and refunding twice.
 */
export async function createReturn(db: Db, input: CreateReturnInput): Promise<CreateReturnResult> {
  // "exchange" is written only by the exchange sale path (sales.ts createSale), which calls
  // writeReturnInTrx directly — never through this standalone entry point.
  if (input.refundMode === "exchange") {
    throw new Error("refundMode 'exchange' can only be set by the exchange sale path.");
  }

  const found = await findReturnByClientTxnId(db, input.clientTxnId);
  if (found) return { saleReturn: found, alreadyExisted: true };
  return createReturnUnchecked(db, input);
}

/**
 * The credit note already written for this client transaction, if any. The returns handler
 * asks this first, so a retried click is answered with the original credit note before any
 * approval prompt or stock check runs again.
 */
export async function findReturnByClientTxnId(db: Db, clientTxnId: string): Promise<SaleReturn | undefined> {
  const row = await db.selectFrom("saleReturns").selectAll().where("clientTxnId", "=", clientTxnId).executeTakeFirst();
  return row ? rowToReturn(row) : undefined;
}

async function createReturnUnchecked(db: Db, input: CreateReturnInput): Promise<CreateReturnResult> {
  return db.transaction().execute(async (trx) => {
    const reCheck = await trx
      .selectFrom("saleReturns")
      .selectAll()
      .where("clientTxnId", "=", input.clientTxnId)
      .executeTakeFirst();
    if (reCheck) {
      return { saleReturn: rowToReturn(reCheck), alreadyExisted: true };
    }

    const { returnId } = await writeReturnInTrx(trx, { ...input, exchange: null });

    const created = await trx
      .selectFrom("saleReturns")
      .selectAll()
      .where("id", "=", returnId)
      .executeTakeFirstOrThrow();
    return { saleReturn: rowToReturn(created), alreadyExisted: false };
  });
}

/**
 * The guts of writing one return: the credit note row, its lines, the stock coming back, the
 * khata ledger entry (when the payout is to credit), and the audit entry. Runs against an
 * already-open transaction — either the return's own (createReturnUnchecked) or the exchange
 * sale's (salesRepo.createSale), so the return leg and the new sale leg of an exchange commit
 * or roll back together.
 *
 * `exchange` is null for a standalone refund. When set, `exchange.paise` of the refund was
 * absorbed into that sale rather than paid out — the khata ledger entry (if any) only ever
 * covers the actual payout, never the absorbed portion.
 */
export async function writeReturnInTrx(
  trx: Db,
  input: CreateReturnInput & { exchange: { saleId: string; billNo: string; paise: number } | null },
): Promise<{ returnId: string; returnNo: string }> {
  if (input.refundMode === "credit" && !input.customerId) {
    throw new RefundToKhataWithoutCustomerError();
  }

  // Closes the race where two counters return the same units at once: each request computes
  // its totals from a read taken before this transaction opened, so only a check against the
  // current committed state, taken now, can catch an overlap.
  const saleItemIds = input.lines.map((l) => l.saleItemId);
  const soldRows =
    saleItemIds.length === 0 ? [] : await trx.selectFrom("saleItems").select(["id", "qty"]).where("id", "in", saleItemIds).execute();
  const soldById = new Map(soldRows.map((r) => [r.id, r.qty]));

  const alreadyReturnedRows =
    saleItemIds.length === 0
      ? []
      : await trx
          .selectFrom("saleReturnItems")
          .select("saleItemId")
          .select((eb) => eb.fn.sum<number | null>("qty").as("qty"))
          .where("saleItemId", "in", saleItemIds)
          .groupBy("saleItemId")
          .execute();
  const alreadyReturnedById = new Map(alreadyReturnedRows.map((r) => [r.saleItemId, Number(r.qty ?? 0)]));

  for (const line of input.lines) {
    const sold = soldById.get(line.saleItemId) ?? 0;
    const alreadyReturned = alreadyReturnedById.get(line.saleItemId) ?? 0;
    if (alreadyReturned + line.qty > sold + 1e-6) {
      throw new ReturnNoLongerAvailableError();
    }
  }

  const returnId = randomUUID();
  const returnNo = await nextBillNumber(trx, returnSequenceKey(input.counterId), input.returnNoPrefix);

  await trx
    .insertInto("saleReturns")
    .values({
      id: returnId,
      storeId: input.storeId,
      counterId: input.counterId,
      saleId: input.saleId,
      returnNo,
      clientTxnId: input.clientTxnId,
      userId: input.userId,
      reason: input.reason,
      taxablePaise: input.totals.taxablePaise,
      cgstPaise: input.totals.cgstPaise,
      sgstPaise: input.totals.sgstPaise,
      discountPaise: input.totals.discountPaise,
      roundOffPaise: input.totals.roundOffPaise,
      refundPaise: input.totals.refundPaise,
      refundMode: input.refundMode,
      approvedByUserId: input.approvedByUserId ?? null,
      exchangeSaleId: input.exchange?.saleId ?? null,
      exchangePaise: input.exchange?.paise ?? 0,
    })
    .execute();

  for (const line of input.lines) {
    await trx
      .insertInto("saleReturnItems")
      .values({
        id: randomUUID(),
        returnId,
        saleItemId: line.saleItemId,
        productId: line.productId,
        qty: line.qty,
        discountPaise: line.discountPaise,
        taxablePaise: line.taxablePaise,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        lineTotalPaise: line.lineTotalPaise,
      })
      .execute();

    // Positive: the goods are coming back onto the shelf.
    await applyStockMovement(trx, {
      id: randomUUID(),
      storeId: input.storeId,
      productId: line.productId,
      qtyChange: line.qty,
      reason: "sale_return",
      referenceType: "sale_return",
      referenceId: returnId,
      userId: input.userId,
    });
  }

  // Only the actual payout — never the portion absorbed into a linked sale — reduces khata.
  const payoutPaise = input.totals.refundPaise - (input.exchange?.paise ?? 0);
  if (input.refundMode === "credit" && input.customerId && payoutPaise > 0) {
    // Negative: a refund to khata reduces what the customer owes.
    await trx
      .insertInto("customerLedgerEntries")
      .values({
        id: randomUUID(),
        storeId: input.storeId,
        customerId: input.customerId,
        entryType: "return_refund",
        amountPaise: -payoutPaise,
        saleId: null,
        paymentMode: null,
        note: input.exchange ? `Return ${returnNo} (bill ${input.exchange.billNo})` : `Return ${returnNo}`,
        userId: input.userId,
      })
      .execute();
  }

  const original = await trx.selectFrom("sales").select("billNo").where("id", "=", input.saleId).executeTakeFirst();

  await appendAuditLog(trx, {
    storeId: input.storeId,
    userId: input.userId,
    deviceId: input.deviceId ?? null,
    action: "sale_return",
    tableName: "sale_returns",
    recordId: returnId,
    oldValue: null,
    newValue: {
      returnNo,
      billNo: original?.billNo ?? null,
      refundPaise: input.totals.refundPaise,
      refundMode: input.refundMode,
      lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      approvedByUserId: input.approvedByUserId ?? null,
      ...(input.exchange ? { exchangeBillNo: input.exchange.billNo, exchangePaise: input.exchange.paise } : {}),
    },
    reason: input.reason,
  });

  return { returnId, returnNo };
}

export async function listRecentReturns(db: Db, storeId: string, limit: number): Promise<RecentReturn[]> {
  const rows = await db
    .selectFrom("saleReturns as r")
    .innerJoin("sales as s", "s.id", "r.saleId")
    .innerJoin("users as u", "u.id", "r.userId")
    .leftJoin("users as a", "a.id", "r.approvedByUserId")
    .leftJoin("sales as x", "x.id", "r.exchangeSaleId")
    .where("r.storeId", "=", storeId)
    .orderBy("r.createdAt", "desc")
    .limit(limit)
    .select([
      "r.id as id",
      "r.returnNo as returnNo",
      "r.createdAt as createdAt",
      "r.refundPaise as refundPaise",
      "r.refundMode as refundMode",
      "r.exchangePaise as exchangePaise",
      "s.billNo as billNo",
      "x.billNo as exchangeBillNo",
      "u.displayName as userName",
      "a.displayName as approvedByName",
    ])
    .execute();

  if (rows.length === 0) return [];

  const counts = await db
    .selectFrom("saleReturnItems")
    .select("returnId")
    .select((eb) => eb.fn.countAll().as("count"))
    .where(
      "returnId",
      "in",
      rows.map((r) => r.id),
    )
    .groupBy("returnId")
    .execute();
  const countByReturn = new Map(counts.map((c) => [c.returnId, Number(c.count)]));

  return rows.map((r) => ({
    id: r.id,
    returnNo: r.returnNo,
    billNo: r.billNo,
    createdAt: r.createdAt,
    refundPaise: r.refundPaise,
    refundMode: r.refundMode,
    itemCount: countByReturn.get(r.id) ?? 0,
    userName: r.userName,
    approvedByName: r.approvedByName,
    exchangeBillNo: r.exchangeBillNo,
    exchangePaise: r.exchangePaise,
  }));
}

function rowToReturn(row: {
  id: string;
  storeId: string;
  counterId: string;
  saleId: string;
  returnNo: string;
  clientTxnId: string;
  userId: string;
  reason: string | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  discountPaise: number;
  roundOffPaise: number;
  refundPaise: number;
  refundMode: "cash" | "upi" | "card" | "credit" | "exchange";
  createdAt: string;
  exchangeSaleId: string | null;
  exchangePaise: number;
}): SaleReturn {
  return { ...row };
}
