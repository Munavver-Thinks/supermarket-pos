import { randomUUID } from "node:crypto";

import {
  computeCartTotals,
  computePurchaseTotals,
  computeReturnTotals,
  ExpiredStockError,
  findExpiredStockConflicts,
} from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { applyStockMovement, getStock, recordStockAdjustment } from "./inventory.js";
import { createProduct } from "./productsAdmin.js";
import { createPurchase } from "./purchases.js";
import { createReturn, getReturnableSale } from "./returns.js";
import { createSale } from "./sales.js";
import { seedFirstRun } from "./seed.js";
import {
  BatchWriteOffError,
  createBatch,
  getExpiredQtyByProduct,
  getMrpCapsForSale,
  listExpiring,
  listForProduct,
  previewMrpCap,
  writeOffBatch,
} from "./stockBatches.js";
import { createSupplier } from "./suppliers.js";

const TODAY = "2026-09-16";

describe("stock batches", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let supplierId: string;
  let productId: string;
  const counterId = "counter-1";

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Test Org",
      storeName: "Test Store",
      deviceName: "Register 1",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    userId = seed.ownerUserId;
    supplierId = (
      await createSupplier(db, storeId, { name: "Balaji", phone: null, email: null, address: null, gstin: null, notes: null })
    ).id;
    productId = await newProduct("Milk 500ml");
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function newProduct(name: string): Promise<string> {
    return createProduct(db, {
      storeId,
      name,
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 3000,
      salePricePaise: 3000,
      costPricePaise: 2500,
      isTaxInclusive: true,
    });
  }

  /** L10: batches never claim more than the shelf count. */
  async function assertInvariant(id = productId): Promise<void> {
    const onHand = await getStock(db, storeId, id);
    const batches = await listForProduct(db, storeId, id);
    const tracked = batches.reduce((sum, b) => sum + b.qtyRemaining, 0);
    expect(tracked).toBeLessThanOrEqual(Math.max(onHand, 0) + 1e-9);
    for (const b of batches) expect(b.qtyRemaining).toBeGreaterThanOrEqual(0);
  }

  async function remainingByBatchNo(): Promise<Record<string, number>> {
    const batches = await listForProduct(db, storeId, productId);
    return Object.fromEntries(batches.map((b) => [b.batchNo ?? "?", b.qtyRemaining]));
  }

  async function receive(
    lines: Array<{ qty: number; batchNo?: string; expiryDate?: string; mrpPaise?: number }>,
    invoiceNo = `INV-${randomUUID().slice(0, 8)}`,
    id = productId,
  ) {
    const { lines: computed, totals } = computePurchaseTotals(
      lines.map((l) => ({ productId: id, costPricePaise: 2500, taxRatePercent: 0, isTaxInclusive: false, ...l })),
    );
    return createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo,
      invoiceDate: TODAY,
      notes: null,
      userId,
      lines: computed,
      totals,
      updateCostPrice: false,
    });
  }

  async function move(qtyChange: number, reason: "sale" | "manual_stock_in" | "adjustment_damaged") {
    await db.transaction().execute(async (trx) => {
      await applyStockMovement(trx, {
        id: randomUUID(),
        storeId,
        productId,
        qtyChange,
        reason,
        referenceType: reason === "sale" ? "sale" : "stock_adjustment",
        referenceId: randomUUID(),
        userId,
        expiryToday: TODAY,
      });
    });
  }

  function saleInput(qty: number, checkStock?: (onHand: Record<string, number>, expired: Record<string, number>) => void) {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId,
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Milk 500ml",
          uom: "pcs",
          qty,
          unitPricePaise: 3000,
          isTaxInclusive: true,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    return {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode: "cash" as const, amountPaise: computed.totals.netPaise, refNo: null }],
      checkStock,
      expiryToday: TODAY,
    };
  }

  it("opens a batch for every received line, dated or not, each stamped with the product's MRP", async () => {
    await receive([{ qty: 10, batchNo: "B1", expiryDate: "2026-10-01" }, { qty: 5 }]);

    expect(await getStock(db, storeId, productId)).toBe(15);
    const batches = await listForProduct(db, storeId, productId);
    expect(batches).toHaveLength(2);
    const dated = batches.find((b) => b.batchNo === "B1");
    expect(dated).toMatchObject({ expiryDate: "2026-10-01", qtyReceived: 10, qtyRemaining: 10, mrpPaise: 3000 });
    expect(dated?.purchaseId).not.toBeNull();
    const undated = batches.find((b) => b.batchNo === null);
    expect(undated).toMatchObject({ expiryDate: null, qtyReceived: 5, qtyRemaining: 5, mrpPaise: 3000 });
    await assertInvariant();
  });

  it("only tracks what is left after paying off a negative count", async () => {
    await move(-4, "sale");
    expect(await getStock(db, storeId, productId)).toBe(-4);

    await receive([{ qty: 10, batchNo: "B1", expiryDate: "2026-10-01" }]);

    expect(await getStock(db, storeId, productId)).toBe(6);
    expect((await listForProduct(db, storeId, productId))[0]?.qtyRemaining).toBe(6);
    await assertInvariant();
  });

  it("sells in-date batches earliest first, then untracked stock, then expired", async () => {
    await receive([
      { qty: 3, batchNo: "LATE", expiryDate: "2026-10-01" },
      { qty: 2, batchNo: "SOON", expiryDate: "2026-09-20" },
      { qty: 2, batchNo: "UNDATED" },
      { qty: 1, batchNo: "EXPIRED", expiryDate: "2026-09-01" },
    ]);
    // Genuinely untracked stock (no batch at all) — a receipt now always opens a batch, so
    // this has to arrive some other way, e.g. a manual stock-in.
    await move(2, "manual_stock_in");
    expect(await getStock(db, storeId, productId)).toBe(10);

    await move(-6, "sale");
    expect(await remainingByBatchNo()).toEqual({ LATE: 0, SOON: 0, UNDATED: 1, EXPIRED: 1 });
    await assertInvariant();

    // 1 from the undated batch, 2 untracked, and only the last unit from expired stock.
    await move(-3, "sale");
    expect(await remainingByBatchNo()).toEqual({ LATE: 0, SOON: 0, UNDATED: 0, EXPIRED: 1 });
    await move(-1, "sale");
    expect(await remainingByBatchNo()).toEqual({ LATE: 0, SOON: 0, UNDATED: 0, EXPIRED: 0 });
    await assertInvariant();
  });

  it("draws down a batch when a bill is saved", async () => {
    await receive([{ qty: 10, batchNo: "B1", expiryDate: "2026-10-01" }]);

    await createSale(db, saleInput(4));

    expect((await listForProduct(db, storeId, productId))[0]?.qtyRemaining).toBe(6);
    expect(await getStock(db, storeId, productId)).toBe(6);
    await assertInvariant();
  });

  it("empties the batches and never throws when a sale goes past recorded stock", async () => {
    await receive([{ qty: 2, batchNo: "B1", expiryDate: "2026-10-01" }]);

    await createSale(db, saleInput(5));

    expect(await getStock(db, storeId, productId)).toBe(-3);
    expect((await listForProduct(db, storeId, productId))[0]?.qtyRemaining).toBe(0);
    await assertInvariant();
  });

  it("sells exactly as before for a shop with stock but no batches", async () => {
    await move(5, "manual_stock_in");
    const { sale } = await createSale(db, saleInput(2));
    expect(sale.billNo).toMatch(/-1$/);
    expect(await getStock(db, storeId, productId)).toBe(3);
    expect(await listForProduct(db, storeId, productId)).toHaveLength(0);
  });

  it("lists expiring and expired batches with their value", async () => {
    await receive([
      { qty: 10, batchNo: "SOON", expiryDate: "2026-10-01" },
      { qty: 4, batchNo: "GONE", expiryDate: "2026-09-15" },
      { qty: 7, batchNo: "LATER", expiryDate: "2027-01-01" },
    ]);

    const rows = await listExpiring(db, storeId, TODAY, 30);
    expect(rows.map((r) => [r.batchNo, r.status])).toEqual([
      ["GONE", "expired"],
      ["SOON", "expiring"],
    ]);
    expect(rows[1]).toMatchObject({ productName: "Milk 500ml", qtyRemaining: 10, valuePaise: 25000 });
    expect(await getExpiredQtyByProduct(db, storeId, [productId], TODAY)).toEqual({ [productId]: 4 });
  });

  it("refuses a sale that would need expired stock, using no bill number", async () => {
    await receive([{ qty: 5, batchNo: "GONE", expiryDate: "2026-09-10" }]);
    const block = (onHand: Record<string, number>, expired: Record<string, number>) => {
      const conflicts = findExpiredStockConflicts([{ productId, name: "Milk 500ml", qty: 1 }], onHand, expired);
      if (conflicts.length > 0) throw new ExpiredStockError(conflicts);
    };

    await expect(createSale(db, saleInput(1, block))).rejects.toThrow(
      "Milk 500ml: 5 of 5 on hand are past expiry — write them off in Inventory before selling.",
    );
    expect(await getStock(db, storeId, productId)).toBe(5);
    expect(await db.selectFrom("sales").select("id").execute()).toHaveLength(0);

    // Without the check the same bill goes through, and is bill number one.
    const { sale } = await createSale(db, saleInput(1));
    expect(sale.billNo).toMatch(/-1$/);
  });

  it("passes no expired stock to the check when no date is given", async () => {
    await receive([{ qty: 5, batchNo: "GONE", expiryDate: "2026-09-10" }]);
    let seen: Record<string, number> | undefined;
    await createSale(db, {
      ...saleInput(1, (_onHand, expired) => {
        seen = expired;
      }),
      expiryToday: undefined,
    });
    expect(seen).toEqual({});
  });

  it("trims batches on a downward correction, expired first, and leaves them on an upward one", async () => {
    await receive([
      { qty: 4, batchNo: "GONE", expiryDate: "2026-09-10" },
      { qty: 4, batchNo: "SOON", expiryDate: "2026-09-30" },
      { qty: 4, batchNo: "UNDATED" },
    ]);

    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 6,
      reason: "adjustment_missing",
      note: null,
      userId,
      approvedByUserId: userId,
    });
    expect(await remainingByBatchNo()).toEqual({ GONE: 0, SOON: 2, UNDATED: 4 });
    await assertInvariant();

    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 20,
      reason: "manual_stock_in",
      note: null,
      userId,
      approvedByUserId: userId,
    });
    expect(await remainingByBatchNo()).toEqual({ GONE: 0, SOON: 2, UNDATED: 4 });
    await assertInvariant();

    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 0,
      reason: "adjustment_correction",
      note: null,
      userId,
      approvedByUserId: userId,
    });
    expect(await remainingByBatchNo()).toEqual({ GONE: 0, SOON: 0, UNDATED: 0 });
    await assertInvariant();
  });

  it("leaves batches alone when goods come back on a return", async () => {
    await receive([{ qty: 5, batchNo: "B1", expiryDate: "2026-10-01" }]);
    const { sale } = await createSale(db, saleInput(3));
    expect(await remainingByBatchNo()).toEqual({ B1: 2 });

    const returnable = await getReturnableSale(db, storeId, sale.billNo);
    const line = returnable?.lines[0];
    if (!returnable || !line) throw new Error("bill not returnable");
    const computed = computeReturnTotals([
      {
        saleItemId: line.saleItemId,
        productId: line.productId,
        soldQty: line.soldQty,
        alreadyReturnedQty: 0,
        returnQty: 2,
        discountPaise: line.discountPaise,
        taxablePaise: line.taxablePaise,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        lineTotalPaise: line.lineTotalPaise,
      },
    ]);
    await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: null,
      clientTxnId: randomUUID(),
      userId,
      reason: null,
      refundMode: "cash",
      lines: computed.lines,
      totals: computed.totals,
    });

    expect(await getStock(db, storeId, productId)).toBe(4);
    expect(await remainingByBatchNo()).toEqual({ B1: 2 });
    await assertInvariant();
  });

  it("writes off a batch once, with its adjustment and audit entry", async () => {
    await receive([
      { qty: 4, batchNo: "GONE", expiryDate: "2026-09-10" },
      { qty: 6, batchNo: "FINE", expiryDate: "2026-12-31" },
    ]);
    const gone = (await listForProduct(db, storeId, productId)).find((b) => b.batchNo === "GONE");
    if (!gone) throw new Error("batch missing");

    const result = await writeOffBatch(db, {
      batchId: gone.id,
      storeId,
      userId,
      approvedByUserId: userId,
      deviceId: "device-1",
      note: "Past date",
    });

    expect(result).toMatchObject({ qty: 4, qtyOnHandBefore: 10, qtyOnHandAfter: 6 });
    expect(await getStock(db, storeId, productId)).toBe(6);
    expect(await remainingByBatchNo()).toEqual({ GONE: 0, FINE: 6 });
    await assertInvariant();

    const adjustments = await db.selectFrom("stockAdjustments").selectAll().execute();
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ reason: "adjustment_expired", qtyBefore: 10, qtyAfter: 6, approvedByUserId: userId });

    const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "batch_written_off" });
    expect(entry?.recordId).toBe(gone.id);
    expect(entry?.newValue).toMatchObject({
      batchNo: "GONE",
      expiryDate: "2026-09-10",
      qty: 4,
      qtyOnHandBefore: 10,
      qtyOnHandAfter: 6,
      approvedByUserId: userId,
    });

    // A second click must change nothing.
    await expect(
      writeOffBatch(db, { batchId: gone.id, storeId, userId, approvedByUserId: userId, deviceId: null, note: null }),
    ).rejects.toThrow(BatchWriteOffError);
    expect(await getStock(db, storeId, productId)).toBe(6);
    expect(await db.selectFrom("stockAdjustments").selectAll().execute()).toHaveLength(1);
    expect(await listAuditLog(db, storeId, { limit: 10, action: "batch_written_off" })).toHaveLength(1);
    await assertInvariant();
  });

  it("never writes a batch off below zero on-hand, and refuses another store's batch", async () => {
    // A batch inserted directly, claiming more than the shelf has, as a damaged database might.
    await move(2, "manual_stock_in");
    const batchId = await db.transaction().execute((trx) =>
      createBatch(trx, {
        storeId,
        productId,
        batchNo: "X",
        expiryDate: "2026-09-01",
        qtyReceived: 5,
        qtyRemaining: 5,
        costPricePaise: 100,
        mrpPaise: null,
        purchaseId: null,
      }),
    );

    await expect(
      writeOffBatch(db, { batchId, storeId: randomUUID(), userId, approvedByUserId: null, deviceId: null, note: null }),
    ).rejects.toThrow("That batch could not be found.");

    const result = await writeOffBatch(db, { batchId, storeId, userId, approvedByUserId: null, deviceId: null, note: null });
    expect(result.qty).toBe(2);
    expect(await getStock(db, storeId, productId)).toBe(0);
    await assertInvariant();
  });

  it("previewMrpCap falls back to the product's MRP when there are no batches", async () => {
    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 2,
      onHandBefore: 5,
      today: TODAY,
      productMrpPaise: 3000,
    });
    expect(cap).toBe(3000);
  });

  it("previewMrpCap caps at the lower of two lots' MRPs when the qty stays within the older one", async () => {
    await receive([{ qty: 5, batchNo: "OLD", expiryDate: "2026-10-01", mrpPaise: 3500 }]);
    await receive([{ qty: 5, batchNo: "NEW", expiryDate: "2026-11-01", mrpPaise: 4000 }]);

    const withinOld = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 3,
      onHandBefore: 10,
      today: TODAY,
      productMrpPaise: 4000,
    });
    expect(withinOld).toBe(3500);

    const spanningBoth = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 7,
      onHandBefore: 10,
      today: TODAY,
      productMrpPaise: 4000,
    });
    expect(spanningBoth).toBe(3500);
  });

  it("previewMrpCap only sees the new lot's MRP once the old lot is fully sold", async () => {
    await receive([{ qty: 5, batchNo: "OLD", expiryDate: "2026-10-01", mrpPaise: 3500 }]);
    await receive([{ qty: 5, batchNo: "NEW", expiryDate: "2026-11-01", mrpPaise: 4000 }]);
    await move(-5, "sale"); // empties the earlier-expiring OLD lot first

    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 2,
      onHandBefore: 5,
      today: TODAY,
      productMrpPaise: 4000,
    });
    expect(cap).toBe(4000);
  });

  it("previewMrpCap falls back to the product's MRP for a batch recorded before MRP tracking (mrpPaise: null)", async () => {
    await db.transaction().execute((trx) =>
      createBatch(trx, {
        storeId,
        productId,
        batchNo: "PRE-TRACKING",
        expiryDate: null,
        qtyReceived: 4,
        qtyRemaining: 4,
        costPricePaise: 2500,
        mrpPaise: null,
        purchaseId: null,
      }),
    );
    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 2,
      onHandBefore: 4,
      today: TODAY,
      productMrpPaise: 3300,
    });
    expect(cap).toBe(3300);
  });

  it("previewMrpCap uses the product's MRP for the untracked portion, even when a tracked lot's own MRP is higher", async () => {
    await receive([{ qty: 3, batchNo: "B1", mrpPaise: 5000 }]);
    await move(2, "manual_stock_in"); // untracked: no batch at all
    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 5,
      onHandBefore: 5,
      today: TODAY,
      productMrpPaise: 3000,
    });
    expect(cap).toBe(3000);
  });

  it("previewMrpCap returns null when every contributing MRP is zero or unset", async () => {
    const cap = await previewMrpCap(db, {
      storeId,
      productId,
      qty: 2,
      onHandBefore: 5,
      today: TODAY,
      productMrpPaise: 0,
    });
    expect(cap).toBeNull();
  });

  it("previewMrpCap never mutates qtyRemaining", async () => {
    await receive([{ qty: 4, batchNo: "B1", mrpPaise: 3500 }]);
    await previewMrpCap(db, { storeId, productId, qty: 3, onHandBefore: 4, today: TODAY, productMrpPaise: 3000 });
    const [batch] = await listForProduct(db, storeId, productId);
    expect(batch?.qtyRemaining).toBe(4);
  });

  it("getMrpCapsForSale sums qty across lines for the same product before capping", async () => {
    await receive([{ qty: 5, batchNo: "OLD", mrpPaise: 3500 }]);
    await receive([{ qty: 5, batchNo: "NEW", mrpPaise: 4000 }]);

    const caps = await getMrpCapsForSale(
      db,
      storeId,
      [
        { productId, qty: 3 },
        { productId, qty: 4 },
      ],
      TODAY,
    );
    expect(caps).toEqual({ [productId]: 3500 });
  });

  it("getMrpCapsForSale leaves a product out of the result when it has no MRP to cap at", async () => {
    const noMrpProductId = await createProduct(db, {
      storeId,
      name: "Loose Rice",
      nameTamil: null,
      shortCode: null,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 0,
      salePricePaise: 5000,
      costPricePaise: 4000,
      isTaxInclusive: true,
    });
    const caps = await getMrpCapsForSale(db, storeId, [{ productId: noMrpProductId, qty: 2 }], TODAY);
    expect(caps).toEqual({});
  });
});
