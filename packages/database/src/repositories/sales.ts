import { randomUUID } from "node:crypto";

// Type-only: packages/database can't depend on @pos/business-logic at runtime (devDependency
// only — see returns.ts's identical import for why), but these shapes are safe to name here.
import type { ReturnLineTotal, ReturnTotals } from "@pos/business-logic";
import type { CartLineTotal, CartTotals, PaymentInput, RecentSale, RefundMode, Sale, SaleItem, SalesSummary } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { nextDailyBillNumber } from "./billNumber.js";
import { recordChangeToKhata, recordCreditSale } from "./customerLedger.js";
import { applyStockMovement, getStockLevels } from "./inventory.js";
import { writeReturnInTrx } from "./returns.js";
import { getExpiredQtyByProduct } from "./stockBatches.js";

export interface CreateSaleInput {
  storeId: string;
  counterId: string;
  billNoPrefix: string;
  userId: string;
  customerId: string | null;
  clientTxnId: string;
  /** Recorded on the audit entry. */
  deviceId?: string | null | undefined;
  lines: CartLineTotal[];
  totals: CartTotals;
  payments: PaymentInput[];
  /**
   * Called inside the sale's transaction with on-hand stock for every product on the bill,
   * before anything is written. Throw to refuse the sale; the transaction rolls back and no
   * bill number is used up.
   *
   * A callback rather than a flag because the stock rule belongs to business-logic, which
   * this package doesn't depend on at runtime — the caller brings the rule, the repository
   * guarantees it runs against the same stock the sale then decrements.
   */
  checkStock?:
    | ((onHandByProduct: Record<string, number>, expiredQtyByProduct: Record<string, number>) => void)
    | undefined;
  /**
   * Today as a local YYYY-MM-DD date, from the caller. Decides which batches count as
   * expired, both for `checkStock` and for which batches the sale draws from. When absent,
   * `checkStock` sees no expired stock.
   */
  expiryToday?: string | undefined;
  /**
   * Set when a discount takes a line below cost and a manager (or the signed-in manager
   * themselves) approved it. Recorded on the sale's audit entry and as its own entry, in
   * the sale's transaction.
   */
  belowCostApproval?: { approvedByUserId: string } | undefined;
  /**
   * Set for an "exchange": this sale also takes back goods from an earlier bill, whose value
   * comes straight off this one (see the billingCreateSale IPC handler for the netting rule).
   * `customerId` is the ORIGINAL bill's customer — may differ from this sale's own customerId
   * above, since the two carts aren't necessarily the same person. `exchangePaise` is how much
   * of the return's refund is being absorbed into this sale rather than paid out.
   */
  exchangeReturn?:
    | {
        originalSaleId: string;
        returnNoPrefix: string;
        customerId: string | null;
        reason: string | null;
        refundMode: RefundMode;
        exchangePaise: number;
        lines: ReturnLineTotal[];
        totals: ReturnTotals;
        approvedByUserId: string;
      }
    | undefined;
}

export interface CreateSaleResult {
  sale: Sale;
  alreadyExisted: boolean;
  /** The credit note written for this sale's linked return, when it was an exchange. */
  exchangeReturnNo?: string;
}

/**
 * Creates a sale, its line items, its payments, and decrements stock for every line —
 * all inside one transaction. Idempotent: calling twice with the same clientTxnId
 * (e.g. a retried click, or a resent offline-queue entry) returns the original sale
 * instead of creating a duplicate or double-decrementing stock.
 *
 * When `exchangeReturn` is set, the return leg (a credit note against an earlier bill) is
 * written in the SAME transaction, via writeReturnInTrx — both legs share this sale's
 * clientTxnId as their idempotency key, so a retry after a crash writes each exactly once.
 */
export async function createSale(db: Db, input: CreateSaleInput): Promise<CreateSaleResult> {
  const existing = await db
    .selectFrom("sales")
    .selectAll()
    .where("clientTxnId", "=", input.clientTxnId)
    .executeTakeFirst();

  if (existing) {
    const exchangeReturnNo = input.exchangeReturn ? await findExchangeReturnNo(db, existing.id) : undefined;
    return { sale: rowToSale(existing), alreadyExisted: true, ...(exchangeReturnNo ? { exchangeReturnNo } : {}) };
  }

  return db.transaction().execute(async (trx) => {
    const reCheck = await trx
      .selectFrom("sales")
      .selectAll()
      .where("clientTxnId", "=", input.clientTxnId)
      .executeTakeFirst();
    if (reCheck) {
      const exchangeReturnNo = input.exchangeReturn ? await findExchangeReturnNo(trx, reCheck.id) : undefined;
      return { sale: rowToSale(reCheck), alreadyExisted: true, ...(exchangeReturnNo ? { exchangeReturnNo } : {}) };
    }

    if (input.checkStock) {
      const productIds = [...new Set(input.lines.map((l) => l.productId))];
      const expired = input.expiryToday
        ? await getExpiredQtyByProduct(trx, input.storeId, productIds, input.expiryToday)
        : {};
      const onHand = await getStockLevels(trx, input.storeId, productIds);
      // The returned units are about to come back onto the shelf in this same transaction
      // (the return leg below is written before the new lines draw stock), so a same-product
      // swap must see them as already available — otherwise the "block" policy would wrongly
      // refuse a return-1-buy-1 exchange of the same item.
      if (input.exchangeReturn) {
        for (const line of input.exchangeReturn.lines) {
          onHand[line.productId] = (onHand[line.productId] ?? 0) + line.qty;
        }
      }
      input.checkStock(onHand, expired);
    }

    const saleId = randomUUID();
    // Resets daily (see nextDailyBillNumber) — the same local day already computed for the
    // expiry check above, so both agree on what day it is.
    const billNo = await nextDailyBillNumber(trx, input.counterId, input.billNoPrefix, input.expiryToday);

    await trx
      .insertInto("sales")
      .values({
        id: saleId,
        storeId: input.storeId,
        counterId: input.counterId,
        billNo,
        clientTxnId: input.clientTxnId,
        userId: input.userId,
        customerId: input.customerId,
        status: "completed",
        grossPaise: input.totals.grossPaise,
        discountPaise: input.totals.discountPaise,
        taxablePaise: input.totals.taxablePaise,
        cgstPaise: input.totals.cgstPaise,
        sgstPaise: input.totals.sgstPaise,
        roundOffPaise: input.totals.roundOffPaise,
        netPaise: input.totals.netPaise,
      })
      .execute();

    // Written after the sale row (so the foreign key from sale_returns.exchange_sale_id is
    // satisfiable) but before the new lines below draw stock out — the returned goods go back
    // on the shelf first, so a same-product swap never sees a transient shortfall.
    let exchangeReturnNo: string | undefined;
    if (input.exchangeReturn) {
      const written = await writeReturnInTrx(trx, {
        storeId: input.storeId,
        counterId: input.counterId,
        returnNoPrefix: input.exchangeReturn.returnNoPrefix,
        saleId: input.exchangeReturn.originalSaleId,
        customerId: input.exchangeReturn.customerId,
        clientTxnId: input.clientTxnId,
        userId: input.userId,
        reason: input.exchangeReturn.reason,
        refundMode: input.exchangeReturn.refundMode,
        lines: input.exchangeReturn.lines,
        totals: input.exchangeReturn.totals,
        deviceId: input.deviceId,
        approvedByUserId: input.exchangeReturn.approvedByUserId,
        exchange: { saleId, billNo, paise: input.exchangeReturn.exchangePaise },
      });
      exchangeReturnNo = written.returnNo;
    }

    let lineNo = 1;
    for (const line of input.lines) {
      await trx
        .insertInto("saleItems")
        .values({
          id: randomUUID(),
          saleId,
          lineNo: lineNo++,
          productId: line.productId,
          qty: line.qty,
          unitPricePaise: line.unitPricePaise,
          discountPaise: line.discountPaise,
          taxablePaise: line.taxablePaise,
          taxRatePercent: line.taxRatePercent,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          lineTotalPaise: line.totalPaise,
        })
        .execute();

      await applyStockMovement(trx, {
        id: randomUUID(),
        storeId: input.storeId,
        productId: line.productId,
        qtyChange: -line.qty,
        reason: "sale",
        referenceType: "sale",
        referenceId: saleId,
        userId: input.userId,
        expiryToday: input.expiryToday,
      });
    }

    let creditPaise = 0;
    for (const payment of input.payments) {
      if (payment.mode === "credit") creditPaise += payment.amountPaise;
      await trx
        .insertInto("payments")
        .values({
          id: randomUUID(),
          saleId,
          mode: payment.mode,
          amountPaise: payment.amountPaise,
          refNo: payment.refNo,
          tenderedPaise: payment.tenderedPaise ?? null,
          changeAction: payment.changeAction ?? null,
        })
        .execute();
    }

    // Inside the transaction on purpose: a bill that sent goods out on credit must not be
    // able to exist without the matching khata entry. If this throws, the sale rolls back.
    await recordCreditSale(trx, {
      storeId: input.storeId,
      customerId: input.customerId,
      saleId,
      amountPaise: creditPaise,
      userId: input.userId,
    });

    // Defense-in-depth: the IPC handler already validates this via cashTenderRejection, but if
    // it somehow throws here (e.g. a direct repository caller), the whole sale rolls back with
    // it, same as the credit leg above.
    const khataLeg = input.payments.find(
      (p) => p.mode === "cash" && p.changeAction === "khata" && p.tenderedPaise != null,
    );
    if (khataLeg) {
      await recordChangeToKhata(trx, {
        storeId: input.storeId,
        customerId: input.customerId,
        saleId,
        billNo,
        amountPaise: khataLeg.tenderedPaise! - khataLeg.amountPaise,
        userId: input.userId,
      });
    }

    // Discount given and how the bill was settled are what a shopkeeper goes looking for
    // later, so they're on the entry itself rather than only reconstructable from joins.
    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      action: "sale_created",
      tableName: "sales",
      recordId: saleId,
      oldValue: null,
      newValue: {
        billNo,
        grossPaise: input.totals.grossPaise,
        discountPaise: input.totals.discountPaise,
        netPaise: input.totals.netPaise,
        lineCount: input.lines.length,
        customerId: input.customerId,
        payments: input.payments.map((p) => ({
          mode: p.mode,
          amountPaise: p.amountPaise,
          ...(p.tenderedPaise != null ? { tenderedPaise: p.tenderedPaise, changeAction: p.changeAction ?? null } : {}),
        })),
        ...(input.belowCostApproval ? { belowCostApprovedByUserId: input.belowCostApproval.approvedByUserId } : {}),
        ...(input.exchangeReturn && exchangeReturnNo
          ? {
              exchangeReturnNo,
              exchangeRefundPaise: input.exchangeReturn.totals.refundPaise,
              exchangePaise: input.exchangeReturn.exchangePaise,
            }
          : {}),
      },
      reason: null,
    });

    // Selling below cost is a decision someone answers for, so it gets its own line in the
    // log — findable without opening every bill.
    if (input.belowCostApproval) {
      await appendAuditLog(trx, {
        storeId: input.storeId,
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        action: "below_cost_discount_approved",
        tableName: "sales",
        recordId: saleId,
        oldValue: null,
        newValue: {
          billNo,
          discountPaise: input.totals.discountPaise,
          approvedByUserId: input.belowCostApproval.approvedByUserId,
        },
        reason: null,
      });
    }

    const created = await trx.selectFrom("sales").selectAll().where("id", "=", saleId).executeTakeFirstOrThrow();
    return {
      sale: rowToSale(created),
      alreadyExisted: false,
      ...(exchangeReturnNo ? { exchangeReturnNo } : {}),
    };
  });
}

/** The credit note already written against a given sale id, for the idempotent-retry path. */
async function findExchangeReturnNo(db: Db, saleId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom("saleReturns")
    .select("returnNo")
    .where("exchangeSaleId", "=", saleId)
    .executeTakeFirst();
  return row?.returnNo;
}

export async function getSaleWithItems(
  db: Db,
  saleId: string,
): Promise<
  { sale: Sale; items: Array<{ item: SaleItem; productName: string; productNameTamil: string | null }> } | undefined
> {
  const saleRow = await db.selectFrom("sales").selectAll().where("id", "=", saleId).executeTakeFirst();
  if (!saleRow) return undefined;

  const itemRows = await db
    .selectFrom("saleItems as si")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("si.saleId", "=", saleId)
    .select([
      "si.id as id",
      "si.saleId as saleId",
      "si.lineNo as lineNo",
      "si.productId as productId",
      "si.qty as qty",
      "si.unitPricePaise as unitPricePaise",
      "si.discountPaise as discountPaise",
      "si.taxablePaise as taxablePaise",
      "si.taxRatePercent as taxRatePercent",
      "si.cgstPaise as cgstPaise",
      "si.sgstPaise as sgstPaise",
      "si.lineTotalPaise as lineTotalPaise",
      "p.name as productName",
      // For bilingual receipts; null for products entered without a Tamil name.
      "p.nameTamil as productNameTamil",
    ])
    .orderBy("si.lineNo")
    .execute();

  return {
    sale: rowToSale(saleRow),
    items: itemRows.map((row) => ({
      item: {
        id: row.id,
        saleId: row.saleId,
        lineNo: row.lineNo,
        productId: row.productId,
        qty: row.qty,
        unitPricePaise: row.unitPricePaise,
        discountPaise: row.discountPaise,
        taxablePaise: row.taxablePaise,
        taxRatePercent: row.taxRatePercent,
        cgstPaise: row.cgstPaise,
        sgstPaise: row.sgstPaise,
        lineTotalPaise: row.lineTotalPaise,
      },
      productName: row.productName,
      productNameTamil: row.productNameTamil,
    })),
  };
}

/** Sums today's completed sales and payments, grouped by payment mode, for the dashboard KPIs. */
export async function getTodaySummary(db: Db, storeId: string): Promise<SalesSummary> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const sales = await db
    .selectFrom("sales")
    .select(["id", "netPaise"])
    .where("storeId", "=", storeId)
    .where("status", "=", "completed")
    .where("createdAt", ">=", startIso)
    .execute();

  const netPaise = sales.reduce((sum, s) => sum + s.netPaise, 0);
  const billCount = sales.length;

  const paymentRows =
    sales.length === 0
      ? []
      : await db
          .selectFrom("payments")
          .select(["mode", "amountPaise"])
          .where(
            "saleId",
            "in",
            sales.map((s) => s.id),
          )
          .execute();

  const mixByMode = new Map<string, number>();
  for (const p of paymentRows) {
    mixByMode.set(p.mode, (mixByMode.get(p.mode) ?? 0) + p.amountPaise);
  }

  return {
    netPaise,
    billCount,
    paymentMix: [...mixByMode.entries()].map(([mode, amountPaise]) => ({
      mode: mode as SalesSummary["paymentMix"][number]["mode"],
      amountPaise,
    })),
  };
}

/** Recent completed sales with cashier/customer display names, for the Sales history screen. */
export async function listRecent(db: Db, storeId: string, limit: number): Promise<RecentSale[]> {
  const rows = await db
    .selectFrom("sales as s")
    .innerJoin("users as u", "u.id", "s.userId")
    .leftJoin("customers as c", "c.id", "s.customerId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .orderBy("s.createdAt", "desc")
    .limit(limit)
    .select([
      "s.id as id",
      "s.billNo as billNo",
      "s.createdAt as createdAt",
      "s.netPaise as netPaise",
      "u.displayName as cashierName",
      "c.name as customerName",
    ])
    .execute();

  if (rows.length === 0) return [];

  const itemCounts = await db
    .selectFrom("saleItems")
    .select("saleId")
    .select((eb) => eb.fn.countAll().as("count"))
    .where(
      "saleId",
      "in",
      rows.map((r) => r.id),
    )
    .groupBy("saleId")
    .execute();
  const countBySale = new Map(itemCounts.map((r) => [r.saleId, Number(r.count)]));

  return rows.map((r) => ({
    id: r.id,
    billNo: r.billNo,
    createdAt: r.createdAt,
    cashierName: r.cashierName,
    customerName: r.customerName,
    itemCount: countBySale.get(r.id) ?? 0,
    netPaise: r.netPaise,
  }));
}

function rowToSale(row: {
  id: string;
  storeId: string;
  counterId: string;
  billNo: string;
  clientTxnId: string;
  userId: string;
  customerId: string | null;
  status: "completed" | "voided";
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  netPaise: number;
  createdAt: string;
}): Sale {
  return { ...row };
}
