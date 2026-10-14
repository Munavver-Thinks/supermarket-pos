import { randomUUID } from "node:crypto";

import type { PurchaseLineTotal, PurchaseTotals } from "@pos/business-logic";
import type {
  Purchase,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderListRow,
  PurchaseOrderStatus,
} from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { nextBillNumber } from "./billNumber.js";
import { createPurchaseInTrx, findByClientTxnId } from "./purchases.js";

/**
 * Purchase orders: draft → ordered → partially_received / received, or cancelled / closed.
 *
 * Nothing here moves stock except receiving, and receiving is an ordinary goods receipt
 * (createPurchaseInTrx) linked back to the order — so stock, batches, cost prices and the
 * purchase_received audit entry follow exactly the same rules as a direct receipt.
 *
 * Money totals are computed by the caller with the purchase engine (business-logic is not a
 * runtime dependency of this package) and passed in.
 */

/** A request that can't be carried out as asked — shown to the user as-is, not logged as a crash. */
export class PurchaseOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseOrderError";
  }
}

/** Anything smaller is float drift from weighed quantities. */
const QTY_TOLERANCE = 1e-9;

export interface PurchaseOrderLineInput {
  productId: string;
  qtyOrdered: number;
  /** Per unit, tax-inclusive or -exclusive per the flag. */
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
}

export interface PurchaseOrderActor {
  storeId: string;
  userId: string;
  deviceId: string | null;
}

type PurchaseOrderRow = Omit<PurchaseOrder, "status"> & { status: string };

function toOrder(row: PurchaseOrderRow): PurchaseOrder {
  return { ...row, status: row.status as PurchaseOrderStatus };
}

async function loadOrder(trx: Db, poId: string, storeId: string): Promise<PurchaseOrder> {
  const row = await trx.selectFrom("purchaseOrders").selectAll().where("id", "=", poId).executeTakeFirst();
  if (!row || row.storeId !== storeId) {
    throw new PurchaseOrderError("That purchase order could not be found.");
  }
  return toOrder(row);
}

async function assertLines(trx: Db, storeId: string, lines: PurchaseOrderLineInput[]): Promise<void> {
  if (lines.length === 0) throw new PurchaseOrderError("A purchase order needs at least one item.");
  for (const line of lines) {
    if (!(line.qtyOrdered > 0)) throw new PurchaseOrderError("Every item needs a quantity above zero.");
  }
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const found = await trx
    .selectFrom("products")
    .select("id")
    .where("storeId", "=", storeId)
    .where("id", "in", productIds)
    .execute();
  if (found.length !== productIds.length) {
    throw new PurchaseOrderError("A product on this order could not be found.");
  }
}

async function insertLines(trx: Db, poId: string, lines: PurchaseOrderLineInput[]): Promise<void> {
  for (const line of lines) {
    await trx
      .insertInto("purchaseOrderItems")
      .values({
        id: randomUUID(),
        purchaseOrderId: poId,
        productId: line.productId,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: 0,
        costPricePaise: line.costPricePaise,
        taxRatePercent: line.taxRatePercent,
        isTaxInclusive: line.isTaxInclusive ? 1 : 0,
      })
      .execute();
  }
}

export async function createPurchaseOrder(
  db: Db,
  input: {
    supplierId: string;
    expectedDate: string | null;
    notes: string | null;
    lines: PurchaseOrderLineInput[];
    totalPaise: number;
  },
  actor: PurchaseOrderActor,
): Promise<PurchaseOrder> {
  return db.transaction().execute(async (trx) => {
    await assertLines(trx, actor.storeId, input.lines);
    const supplier = await trx
      .selectFrom("suppliers")
      .select(["id", "storeId"])
      .where("id", "=", input.supplierId)
      .executeTakeFirst();
    if (!supplier || supplier.storeId !== actor.storeId) {
      throw new PurchaseOrderError("That supplier could not be found.");
    }

    const id = randomUUID();
    // Its own sequence, so PO numbers never eat into the gap-free bill numbering.
    const poNo = await nextBillNumber(trx, `po:${actor.storeId}`, "PO");

    await trx
      .insertInto("purchaseOrders")
      .values({
        id,
        storeId: actor.storeId,
        supplierId: input.supplierId,
        poNo,
        status: "draft",
        expectedDate: input.expectedDate,
        notes: input.notes,
        totalPaise: input.totalPaise,
        createdBy: actor.userId,
        orderedAt: null,
        closedAt: null,
      })
      .execute();
    await insertLines(trx, id, input.lines);

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "purchase_order_created",
      tableName: "purchase_orders",
      recordId: id,
      oldValue: null,
      newValue: { poNo, supplierId: input.supplierId, lineCount: input.lines.length, totalPaise: input.totalPaise },
      reason: input.notes,
    });

    return loadOrder(trx, id, actor.storeId);
  });
}

/** Replaces a draft's details and lines. Once placed, an order is cancelled rather than edited. */
export async function updatePurchaseOrder(
  db: Db,
  poId: string,
  input: {
    expectedDate: string | null;
    notes: string | null;
    lines: PurchaseOrderLineInput[];
    totalPaise: number;
  },
  actor: PurchaseOrderActor,
): Promise<PurchaseOrder> {
  return db.transaction().execute(async (trx) => {
    const order = await loadOrder(trx, poId, actor.storeId);
    if (order.status !== "draft") {
      throw new PurchaseOrderError("Only a draft purchase order can be edited.");
    }
    await assertLines(trx, actor.storeId, input.lines);
    const before = await trx
      .selectFrom("purchaseOrderItems")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("purchaseOrderId", "=", poId)
      .executeTakeFirst();

    await trx.deleteFrom("purchaseOrderItems").where("purchaseOrderId", "=", poId).execute();
    await insertLines(trx, poId, input.lines);
    await trx
      .updateTable("purchaseOrders")
      .set({
        expectedDate: input.expectedDate,
        notes: input.notes,
        totalPaise: input.totalPaise,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", poId)
      .execute();

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "purchase_order_updated",
      tableName: "purchase_orders",
      recordId: poId,
      oldValue: { poNo: order.poNo, lineCount: Number(before?.count ?? 0), totalPaise: order.totalPaise },
      newValue: { poNo: order.poNo, lineCount: input.lines.length, totalPaise: input.totalPaise },
      reason: null,
    });

    return loadOrder(trx, poId, actor.storeId);
  });
}

/** draft → ordered: the order has gone to the supplier. */
export async function placePurchaseOrder(db: Db, poId: string, actor: PurchaseOrderActor): Promise<PurchaseOrder> {
  return db.transaction().execute(async (trx) => {
    const order = await loadOrder(trx, poId, actor.storeId);
    if (order.status !== "draft") {
      throw new PurchaseOrderError("Only a draft purchase order can be placed.");
    }
    const now = new Date().toISOString();
    await trx
      .updateTable("purchaseOrders")
      .set({ status: "ordered", orderedAt: now, updatedAt: now })
      .where("id", "=", poId)
      .execute();

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "purchase_order_placed",
      tableName: "purchase_orders",
      recordId: poId,
      oldValue: { status: order.status },
      newValue: { poNo: order.poNo, status: "ordered", totalPaise: order.totalPaise },
      reason: null,
    });
    return loadOrder(trx, poId, actor.storeId);
  });
}

/**
 * Stops an order. With nothing received it is cancelled; once some goods have come in it is
 * closed instead, so the receipts already booked against it still read as part of an order.
 */
export async function cancelPurchaseOrder(
  db: Db,
  poId: string,
  reason: string | null,
  actor: PurchaseOrderActor,
): Promise<PurchaseOrder> {
  return db.transaction().execute(async (trx) => {
    const order = await loadOrder(trx, poId, actor.storeId);
    let next: PurchaseOrderStatus;
    if (order.status === "draft" || order.status === "ordered") next = "cancelled";
    else if (order.status === "partially_received") next = "closed";
    else throw new PurchaseOrderError("This purchase order is already finished.");

    const now = new Date().toISOString();
    await trx
      .updateTable("purchaseOrders")
      .set({ status: next, closedAt: now, updatedAt: now })
      .where("id", "=", poId)
      .execute();

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "purchase_order_cancelled",
      tableName: "purchase_orders",
      recordId: poId,
      oldValue: { status: order.status },
      newValue: { poNo: order.poNo, status: next },
      reason,
    });
    return loadOrder(trx, poId, actor.storeId);
  });
}

export interface ReceivePurchaseOrderInput {
  poId: string;
  /** Retry key: a repeat returns the first receipt and changes nothing. */
  clientTxnId: string;
  invoiceNo: string;
  invoiceDate: string;
  notes: string | null;
  updateCostPrice: boolean;
  /** Each received line, tied to the order item it fills. */
  lines: Array<{ poItemId: string; line: PurchaseLineTotal }>;
  totals: PurchaseTotals;
}

export interface ReceivePurchaseOrderResult {
  purchase: Purchase;
  order: PurchaseOrder;
  alreadyExisted: boolean;
}

/**
 * Books goods that arrived against an order, in one transaction: the goods receipt (stock,
 * batches, cost prices, its audit entry), the received quantities on the order, the order's
 * new status and a goods_received audit entry. Any refusal — including a supplier invoice
 * number already on file — rolls all of it back.
 */
export async function receivePurchaseOrder(
  db: Db,
  input: ReceivePurchaseOrderInput,
  actor: PurchaseOrderActor,
): Promise<ReceivePurchaseOrderResult> {
  const prior = await findByClientTxnId(db, input.clientTxnId);
  if (prior) {
    return { purchase: prior, order: await loadOrder(db, input.poId, actor.storeId), alreadyExisted: true };
  }

  return db.transaction().execute(async (trx) => {
    const again = await findByClientTxnId(trx, input.clientTxnId);
    if (again) {
      return { purchase: again, order: await loadOrder(trx, input.poId, actor.storeId), alreadyExisted: true };
    }

    const invoiceNo = input.invoiceNo.trim();
    if (!invoiceNo) throw new PurchaseOrderError("Enter the supplier's invoice number.");
    if (input.lines.length === 0) throw new PurchaseOrderError("Enter at least one quantity received.");

    const order = await loadOrder(trx, input.poId, actor.storeId);
    if (order.status !== "ordered" && order.status !== "partially_received") {
      throw new PurchaseOrderError(
        order.status === "draft"
          ? "Place this purchase order before receiving goods against it."
          : "This purchase order is already finished.",
      );
    }

    const items = await trx
      .selectFrom("purchaseOrderItems")
      .selectAll()
      .where("purchaseOrderId", "=", order.id)
      .execute();
    const byId = new Map(items.map((i) => [i.id, i]));
    const receivedNow = new Map<string, number>();

    for (const { poItemId, line } of input.lines) {
      const item = byId.get(poItemId);
      if (!item) throw new PurchaseOrderError("An item received is not on this purchase order.");
      if (item.productId !== line.productId) {
        throw new PurchaseOrderError("An item received does not match the product ordered.");
      }
      if (!(line.qty > 0)) throw new PurchaseOrderError("Every quantity received must be above zero.");
      const total = (receivedNow.get(poItemId) ?? 0) + line.qty;
      const remaining = item.qtyOrdered - item.qtyReceived;
      if (total - remaining > QTY_TOLERANCE) {
        throw new PurchaseOrderError(
          `Only ${Math.round(remaining * 1000) / 1000} more can be received for one of the items — ` +
            "receiving more than was ordered isn't supported.",
        );
      }
      receivedNow.set(poItemId, total);
    }

    const purchase = await createPurchaseInTrx(trx, {
      storeId: actor.storeId,
      supplierId: order.supplierId,
      invoiceNo,
      invoiceDate: input.invoiceDate,
      notes: input.notes,
      userId: actor.userId,
      lines: input.lines.map((l) => l.line),
      totals: input.totals,
      updateCostPrice: input.updateCostPrice,
      deviceId: actor.deviceId,
      clientTxnId: input.clientTxnId,
      purchaseOrderId: order.id,
    });

    let complete = true;
    for (const item of items) {
      const qtyReceived = item.qtyReceived + (receivedNow.get(item.id) ?? 0);
      if (receivedNow.has(item.id)) {
        await trx.updateTable("purchaseOrderItems").set({ qtyReceived }).where("id", "=", item.id).execute();
      }
      if (item.qtyOrdered - qtyReceived > QTY_TOLERANCE) complete = false;
    }

    const status: PurchaseOrderStatus = complete ? "received" : "partially_received";
    const now = new Date().toISOString();
    await trx
      .updateTable("purchaseOrders")
      .set({ status, updatedAt: now, closedAt: complete ? now : null })
      .where("id", "=", order.id)
      .execute();

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "goods_received",
      tableName: "purchase_orders",
      recordId: order.id,
      oldValue: { status: order.status },
      newValue: {
        poNo: order.poNo,
        invoiceNo,
        purchaseId: purchase.id,
        lineCount: input.lines.length,
        totalPaise: input.totals.totalPaise,
        status,
      },
      reason: input.notes,
    });

    return { purchase, order: await loadOrder(trx, order.id, actor.storeId), alreadyExisted: false };
  });
}

export async function listPurchaseOrders(
  db: Db,
  storeId: string,
  options: { status?: PurchaseOrderStatus | undefined; limit: number },
): Promise<PurchaseOrderListRow[]> {
  let query = db
    .selectFrom("purchaseOrders as po")
    .innerJoin("suppliers as s", "s.id", "po.supplierId")
    .where("po.storeId", "=", storeId);
  if (options.status) query = query.where("po.status", "=", options.status);

  const rows = await query
    .orderBy("po.createdAt", "desc")
    .limit(options.limit)
    .selectAll("po")
    .select((eb) => [
      "s.name as supplierName",
      eb
        .selectFrom("purchaseOrderItems as i")
        .whereRef("i.purchaseOrderId", "=", "po.id")
        .select((inner) => inner.fn.countAll<number>().as("count"))
        .as("itemCount"),
      eb
        .selectFrom("purchases as p")
        .whereRef("p.purchaseOrderId", "=", "po.id")
        .select((inner) => inner.fn.sum<number>("p.totalPaise").as("total"))
        .as("receivedPaise"),
    ])
    .execute();

  return rows.map((row) => ({
    ...toOrder(row),
    supplierName: row.supplierName,
    itemCount: Number(row.itemCount ?? 0),
    receivedPaise: Number(row.receivedPaise ?? 0),
  }));
}

export async function getPurchaseOrder(db: Db, poId: string): Promise<PurchaseOrderDetail | undefined> {
  const row = await db
    .selectFrom("purchaseOrders as po")
    .innerJoin("suppliers as s", "s.id", "po.supplierId")
    .where("po.id", "=", poId)
    .selectAll("po")
    .select("s.name as supplierName")
    .executeTakeFirst();
  if (!row) return undefined;

  const items = await db
    .selectFrom("purchaseOrderItems as i")
    .innerJoin("products as p", "p.id", "i.productId")
    .where("i.purchaseOrderId", "=", poId)
    .orderBy("p.name")
    .selectAll("i")
    .select(["p.name as productName", "p.uom as uom"])
    .execute();

  const receipts = await db
    .selectFrom("purchases")
    .where("purchaseOrderId", "=", poId)
    .orderBy("createdAt", "asc")
    .select(["id as purchaseId", "invoiceNo", "invoiceDate", "totalPaise", "createdAt"])
    .execute();

  const { supplierName, ...order } = row;
  return {
    order: toOrder(order),
    supplierName,
    items: items.map((i) => ({
      ...i,
      isTaxInclusive: i.isTaxInclusive === 1,
      qtyRemaining: Math.max(0, i.qtyOrdered - i.qtyReceived),
    })),
    receipts,
  };
}
