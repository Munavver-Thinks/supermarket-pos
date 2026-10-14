import { randomUUID } from "node:crypto";

import type { PurchaseLineTotal, PurchaseTotals } from "@pos/business-logic";
import type { Purchase, PurchaseListRow, PurchasePriceSnapshot, PurchaseWithItems } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { applyStockMovement, getStock } from "./inventory.js";
import { cascadeLinkedChildPrices, type ProductAuditActor } from "./productsAdmin.js";
import { createBatch, sumRemaining, trackUntrackedStock } from "./stockBatches.js";

export interface CreatePurchaseInput {
  storeId: string;
  supplierId: string;
  invoiceNo: string | null;
  invoiceDate: string;
  notes: string | null;
  userId: string;
  /** Every line opens a stock batch, carrying batchNo / expiryDate / mrpPaise when given. */
  lines: PurchaseLineTotal[];
  totals: PurchaseTotals;
  /** Whether receiving these goods also blends into each product's recorded cost price — a
   * weighted average of the stock already on hand and what's newly received, not an overwrite. */
  updateCostPrice: boolean;
  /** Recorded on the audit entries. */
  deviceId?: string | null | undefined;
  /**
   * Retry key. A second call with a key already recorded returns the first purchase and
   * changes nothing, so a double-clicked Receive can't raise stock twice. Purchases saved
   * before this existed have none.
   */
  clientTxnId?: string | null | undefined;
  /** Set when the goods are received against a purchase order. */
  purchaseOrderId?: string | null | undefined;
}

/** Thrown when the same supplier invoice number is recorded twice — receiving it again would double the stock. */
export class DuplicatePurchaseInvoiceError extends Error {
  constructor(invoiceNo: string) {
    super(`Invoice ${invoiceNo} is already recorded for this supplier.`);
    this.name = "DuplicatePurchaseInvoiceError";
  }
}

export async function findByClientTxnId(db: Db, clientTxnId: string): Promise<Purchase | undefined> {
  return db.selectFrom("purchases").selectAll().where("clientTxnId", "=", clientTxnId).executeTakeFirst();
}

/**
 * Records a received supplier invoice: the header, its line items, a stock increase per
 * line (with its append-only ledger entry), and optionally a new effective-dated cost
 * price per product — all inside one transaction, so a failure part-way can never leave
 * stock raised against a purchase that wasn't saved.
 */
export async function createPurchase(db: Db, input: CreatePurchaseInput): Promise<Purchase> {
  if (input.lines.length === 0) {
    throw new Error("A purchase needs at least one line item.");
  }
  if (input.clientTxnId) {
    const existing = await findByClientTxnId(db, input.clientTxnId);
    if (existing) return existing;
  }

  return db.transaction().execute(async (trx) => {
    if (input.clientTxnId) {
      const existing = await findByClientTxnId(trx, input.clientTxnId);
      if (existing) return existing;
    }
    return createPurchaseInTrx(trx, input);
  });
}

/**
 * The body of a goods receipt, for callers that already hold a transaction — receiving
 * against a purchase order runs this alongside its own updates so both commit or neither.
 * Does not check the retry key; callers do that first.
 */
export async function createPurchaseInTrx(trx: Db, input: CreatePurchaseInput): Promise<Purchase> {
  if (input.lines.length === 0) {
    throw new Error("A purchase needs at least one line item.");
  }

  if (input.invoiceNo) {
    const duplicate = await trx
      .selectFrom("purchases")
      .select("id")
      .where("supplierId", "=", input.supplierId)
      .where("invoiceNo", "=", input.invoiceNo)
      .executeTakeFirst();
    if (duplicate) {
      throw new DuplicatePurchaseInvoiceError(input.invoiceNo);
    }
  }

  const purchaseId = randomUUID();

  await trx
    .insertInto("purchases")
    .values({
      id: purchaseId,
      storeId: input.storeId,
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      invoiceDate: input.invoiceDate,
      notes: input.notes,
      subtotalPaise: input.totals.subtotalPaise,
      taxPaise: input.totals.taxPaise,
      totalPaise: input.totals.totalPaise,
      userId: input.userId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      clientTxnId: input.clientTxnId ?? null,
    })
    .execute();

  for (const line of input.lines) {
    // Read before this line's own stock movement is applied, so the weighted average blends
    // against what was on the shelf before this line, not after. When the same product
    // appears on two lines of one invoice, each line's average builds on the previous line's
    // result, since this loop runs sequentially rather than in parallel.
    const onHandBefore = await getStock(trx, input.storeId, line.productId);

    const currentPrice = await trx
      .selectFrom("productPrices")
      .select(["mrpPaise", "costPricePaise"])
      .where("productId", "=", line.productId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    const lineMrp = line.mrpPaise ?? currentPrice?.mrpPaise ?? 0;

    if (currentPrice && line.mrpPaise != null && line.mrpPaise !== currentPrice.mrpPaise) {
      // Pin any pre-existing untracked stock to the OLD MRP before the product's MRP
      // changes under it — otherwise it would silently inherit the new MRP.
      await trackUntrackedStock(trx, {
        storeId: input.storeId,
        productId: line.productId,
        onHand: onHandBefore,
        costPricePaise: currentPrice.costPricePaise,
        mrpPaise: currentPrice.mrpPaise,
      });
    }

    await trx
      .insertInto("purchaseItems")
      .values({
        id: randomUUID(),
        purchaseId,
        productId: line.productId,
        qty: line.qty,
        costPricePaise: line.costPricePaise,
        taxRatePercent: line.taxRatePercent,
        taxablePaise: line.taxablePaise,
        taxPaise: line.taxPaise,
        lineTotalPaise: line.lineTotalPaise,
      })
      .execute();

    await applyStockMovement(trx, {
      id: randomUUID(),
      storeId: input.storeId,
      productId: line.productId,
      qtyChange: line.qty,
      reason: "purchase_received",
      referenceType: "purchase",
      referenceId: purchaseId,
      userId: input.userId,
    });

    // Every line opens a batch now, even an undated one with no batch number — otherwise
    // there would be nowhere to store a per-lot MRP, and old untracked stock would wrongly
    // inherit whatever MRP comes in next. The batch may only claim stock the shelf count
    // actually has: receiving into a negative count first pays off the shortfall, and only
    // the rest is tracked.
    const onHandAfter = await getStock(trx, input.storeId, line.productId);
    const otherBatches = await sumRemaining(trx, input.storeId, line.productId);
    await createBatch(trx, {
      storeId: input.storeId,
      productId: line.productId,
      batchNo: line.batchNo ?? null,
      expiryDate: line.expiryDate ?? null,
      qtyReceived: line.qty,
      qtyRemaining: Math.min(line.qty, Math.max(onHandAfter, 0) - otherBatches),
      costPricePaise: unitCost(line),
      mrpPaise: lineMrp,
      purchaseId,
    });

    if (input.updateCostPrice || line.mrpPaise != null) {
      const qtyOnHandBefore = Math.max(onHandBefore, 0);
      const change = await recordReceiptPrices(trx, {
        productId: line.productId,
        qtyOnHandBefore,
        qtyReceived: line.qty,
        receivedTaxablePaise: line.taxablePaise,
        updateCost: input.updateCostPrice,
        newMrpPaise: line.mrpPaise ?? null,
        actor: { storeId: input.storeId, userId: input.userId, deviceId: input.deviceId ?? null },
      });
      // A cost change moves every margin and the below-cost discount guard, and an MRP
      // change is a separate legal fact — each is logged on its own, only when it happened.
      if (change?.cost) {
        await appendAuditLog(trx, {
          storeId: input.storeId,
          userId: input.userId,
          deviceId: input.deviceId ?? null,
          action: "cost_price_changed",
          tableName: "product_prices",
          recordId: line.productId,
          oldValue: { costPricePaise: change.cost.beforePaise },
          newValue: {
            costPricePaise: change.cost.afterPaise,
            receivedCostPaise: unitCost(line),
            qtyOnHandBefore,
            qtyReceived: line.qty,
          },
          reason: `Purchase ${input.invoiceNo ?? purchaseId}`,
        });
      }
      if (change?.mrp) {
        await appendAuditLog(trx, {
          storeId: input.storeId,
          userId: input.userId,
          deviceId: input.deviceId ?? null,
          action: "mrp_changed",
          tableName: "product_prices",
          recordId: line.productId,
          oldValue: change.mrp.before,
          newValue: { ...change.mrp.after, qtyReceived: line.qty },
          reason: `Purchase ${input.invoiceNo ?? purchaseId}`,
        });
      }
    }
  }

  await appendAuditLog(trx, {
    storeId: input.storeId,
    userId: input.userId,
    deviceId: input.deviceId ?? null,
    action: "purchase_received",
    tableName: "purchases",
    recordId: purchaseId,
    oldValue: null,
    newValue: {
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      totalPaise: input.totals.totalPaise,
      lineCount: input.lines.length,
      updateCostPrice: input.updateCostPrice,
      purchaseOrderId: input.purchaseOrderId ?? null,
    },
    reason: input.notes,
  });

  return trx.selectFrom("purchases").selectAll().where("id", "=", purchaseId).executeTakeFirstOrThrow();
}

/** Tax-exclusive per-unit cost, matching what the below-cost billing guard compares against. */
function unitCost(line: PurchaseLineTotal): number {
  if (line.qty === 0) return 0;
  return Math.round(line.taxablePaise / line.qty);
}

/**
 * Duplicate of @pos/business-logic's weightedAverageCost — this package can't import
 * business-logic at runtime (only as a devDependency for types/tests), so the formula is
 * copied here. Keep in sync with packages/business-logic/src/costing.ts.
 */
function weightedAverageCostLocal(input: {
  qtyOnHandBefore: number;
  currentCostPaise: number;
  qtyReceived: number;
  receivedTaxablePaise: number;
}): number {
  const { qtyOnHandBefore, currentCostPaise, qtyReceived, receivedTaxablePaise } = input;
  if (qtyReceived <= 0 || receivedTaxablePaise <= 0) return currentCostPaise;

  const oldQty = Math.max(qtyOnHandBefore, 0);
  const unit = Math.round(receivedTaxablePaise / qtyReceived);
  if (oldQty <= 0 || currentCostPaise <= 0) return unit;

  return Math.round((oldQty * currentCostPaise + receivedTaxablePaise) / (oldQty + qtyReceived));
}

/**
 * Closes the product's current open price row and opens a new one carrying whatever changed
 * from this receipt: the weighted-average cost (only when `updateCost` is on) and/or a flat
 * MRP replacement (whenever the line sends one, independent of `updateCost` — MRP is a legal
 * fact, not a cost-averaging decision). Both land in the same new row, never two separate
 * writes. A lower new MRP also lowers the sale/wholesale price in that same row, keeping the
 * sale ≤ MRP invariant on the open row; a higher MRP never raises them back up. Price history
 * is effective-dated rather than overwritten, so old sales stay explainable against the cost
 * that applied when they happened. Returns null when nothing changed at all.
 *
 * When the product is a parent (no parentProductId), the new prices cascade to any pack-size
 * children still linked to it, exactly as a direct price edit on productsAdmin.ts does. When
 * the product IS itself a linked child, only its own row is updated — it is deliberately left
 * linked: unlinking as a side-effect of receiving goods would surprise the user, and the next
 * parent price change will re-derive this child's prices anyway.
 */
async function recordReceiptPrices(
  trx: Db,
  input: {
    productId: string;
    qtyOnHandBefore: number;
    qtyReceived: number;
    receivedTaxablePaise: number;
    updateCost: boolean;
    newMrpPaise: number | null;
    actor: ProductAuditActor;
  },
): Promise<{
  cost: { beforePaise: number; afterPaise: number } | null;
  mrp: {
    before: { mrpPaise: number; salePricePaise: number; wholesalePricePaise: number | null };
    after: { mrpPaise: number; salePricePaise: number; wholesalePricePaise: number | null };
  } | null;
} | null> {
  const current = await trx
    .selectFrom("productPrices")
    .selectAll()
    .where("productId", "=", input.productId)
    .where("effectiveTo", "is", null)
    .executeTakeFirst();

  if (!current) return null;

  const newCost = input.updateCost
    ? weightedAverageCostLocal({
        qtyOnHandBefore: input.qtyOnHandBefore,
        currentCostPaise: current.costPricePaise,
        qtyReceived: input.qtyReceived,
        receivedTaxablePaise: input.receivedTaxablePaise,
      })
    : current.costPricePaise;
  const newMrp = input.newMrpPaise ?? current.mrpPaise;
  const newSale = newMrp > 0 ? Math.min(current.salePricePaise, newMrp) : current.salePricePaise;
  const newWholesale =
    current.wholesalePricePaise == null
      ? null
      : newMrp > 0
        ? Math.min(current.wholesalePricePaise, newMrp)
        : current.wholesalePricePaise;

  if (
    newCost === current.costPricePaise &&
    newMrp === current.mrpPaise &&
    newSale === current.salePricePaise &&
    newWholesale === current.wholesalePricePaise
  ) {
    return null;
  }

  const now = new Date().toISOString();

  await trx.updateTable("productPrices").set({ effectiveTo: now }).where("id", "=", current.id).execute();

  await trx
    .insertInto("productPrices")
    .values({
      id: randomUUID(),
      productId: input.productId,
      mrpPaise: newMrp,
      salePricePaise: newSale,
      costPricePaise: newCost,
      wholesalePricePaise: newWholesale,
      isTaxInclusive: current.isTaxInclusive,
      effectiveFrom: now,
      effectiveTo: null,
    })
    .execute();

  const product = await trx
    .selectFrom("products")
    .select(["parentProductId"])
    .where("id", "=", input.productId)
    .executeTakeFirst();

  if (product && !product.parentProductId) {
    await cascadeLinkedChildPrices(
      trx,
      input.productId,
      {
        mrpPaise: newMrp,
        salePricePaise: newSale,
        costPricePaise: newCost,
        wholesalePricePaise: newWholesale,
        isTaxInclusive: current.isTaxInclusive === 1,
      },
      input.actor,
    );
  }

  return {
    cost: newCost === current.costPricePaise ? null : { beforePaise: current.costPricePaise, afterPaise: newCost },
    mrp:
      newMrp === current.mrpPaise && newSale === current.salePricePaise && newWholesale === current.wholesalePricePaise
        ? null
        : {
            before: {
              mrpPaise: current.mrpPaise,
              salePricePaise: current.salePricePaise,
              wholesalePricePaise: current.wholesalePricePaise,
            },
            after: { mrpPaise: newMrp, salePricePaise: newSale, wholesalePricePaise: newWholesale },
          },
  };
}

/**
 * Current price + stock snapshot for a batch of products, used by the purchase screens so a
 * receipt line's cost box seeds from the product's own recorded cost — never its sale price.
 * Empty input returns an empty map without querying.
 */
export async function getPriceSnapshots(
  db: Db,
  storeId: string,
  productIds: string[],
): Promise<Record<string, PurchasePriceSnapshot>> {
  if (productIds.length === 0) return {};

  const rows = await db
    .selectFrom("products as p")
    .leftJoin("productPrices as pp", (join) =>
      join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null),
    )
    .leftJoin("inventory as inv", (join) =>
      join.onRef("inv.productId", "=", "p.id").on("inv.storeId", "=", storeId),
    )
    .where("p.storeId", "=", storeId)
    .where("p.id", "in", productIds)
    .select([
      "p.id as productId",
      "p.taxRatePercent as taxRatePercent",
      "pp.costPricePaise as costPricePaise",
      "pp.salePricePaise as salePricePaise",
      "pp.wholesalePricePaise as wholesalePricePaise",
      "pp.mrpPaise as mrpPaise",
      "pp.isTaxInclusive as isTaxInclusive",
      "inv.qtyOnHand as qtyOnHand",
    ])
    .execute();

  const result: Record<string, PurchasePriceSnapshot> = {};
  for (const row of rows) {
    result[row.productId] = {
      productId: row.productId,
      costPricePaise: row.costPricePaise ?? 0,
      salePricePaise: row.salePricePaise ?? 0,
      wholesalePricePaise: row.wholesalePricePaise ?? null,
      mrpPaise: row.mrpPaise ?? 0,
      isTaxInclusive: (row.isTaxInclusive ?? 0) === 1,
      taxRatePercent: row.taxRatePercent,
      qtyOnHand: row.qtyOnHand ?? 0,
    };
  }
  return result;
}

export async function listRecentPurchases(db: Db, storeId: string, limit: number): Promise<PurchaseListRow[]> {
  const rows = await db
    .selectFrom("purchases as p")
    .innerJoin("suppliers as s", "s.id", "p.supplierId")
    .where("p.storeId", "=", storeId)
    .orderBy("p.createdAt", "desc")
    .limit(limit)
    .select((eb) => [
      "p.id as id",
      "p.storeId as storeId",
      "p.supplierId as supplierId",
      "p.invoiceNo as invoiceNo",
      "p.invoiceDate as invoiceDate",
      "p.notes as notes",
      "p.subtotalPaise as subtotalPaise",
      "p.taxPaise as taxPaise",
      "p.totalPaise as totalPaise",
      "p.userId as userId",
      "p.createdAt as createdAt",
      "p.purchaseOrderId as purchaseOrderId",
      "s.name as supplierName",
      eb
        .selectFrom("purchaseItems")
        .whereRef("purchaseItems.purchaseId", "=", "p.id")
        .select((inner) => inner.fn.countAll<number>().as("count"))
        .as("itemCount"),
    ])
    .execute();

  return rows.map((row) => ({ ...row, itemCount: Number(row.itemCount ?? 0) }));
}

export async function getPurchaseWithItems(db: Db, purchaseId: string): Promise<PurchaseWithItems | undefined> {
  const purchase = await db
    .selectFrom("purchases as p")
    .innerJoin("suppliers as s", "s.id", "p.supplierId")
    .where("p.id", "=", purchaseId)
    .select([
      "p.id as id",
      "p.storeId as storeId",
      "p.supplierId as supplierId",
      "p.invoiceNo as invoiceNo",
      "p.invoiceDate as invoiceDate",
      "p.notes as notes",
      "p.subtotalPaise as subtotalPaise",
      "p.taxPaise as taxPaise",
      "p.totalPaise as totalPaise",
      "p.userId as userId",
      "p.createdAt as createdAt",
      "p.purchaseOrderId as purchaseOrderId",
      "s.name as supplierName",
    ])
    .executeTakeFirst();

  if (!purchase) return undefined;

  const items = await db
    .selectFrom("purchaseItems as pi")
    .innerJoin("products as pr", "pr.id", "pi.productId")
    .where("pi.purchaseId", "=", purchaseId)
    .select([
      "pi.id as id",
      "pi.purchaseId as purchaseId",
      "pi.productId as productId",
      "pi.qty as qty",
      "pi.costPricePaise as costPricePaise",
      "pi.taxRatePercent as taxRatePercent",
      "pi.taxablePaise as taxablePaise",
      "pi.taxPaise as taxPaise",
      "pi.lineTotalPaise as lineTotalPaise",
      "pr.name as productName",
      "pr.uom as uom",
    ])
    .execute();

  const { supplierName, ...rest } = purchase;
  return { purchase: rest, supplierName, items };
}

/** Total purchase spend for a store since the given ISO timestamp — used by the purchases summary. */
export async function getPurchaseSpendSince(db: Db, storeId: string, sinceIso: string): Promise<number> {
  const row = await db
    .selectFrom("purchases")
    .where("storeId", "=", storeId)
    .where("createdAt", ">=", sinceIso)
    .select((eb) => eb.fn.sum<number>("totalPaise").as("total"))
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}
