import { randomUUID } from "node:crypto";

import {
  computeCartTotals,
  computePurchaseTotals,
  computeReturnTotals,
  findStockShortfalls,
  InsufficientStockError,
} from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { listAuditLog } from "@/core/database/repositories/auditLog.js";
import { createCustomer } from "@/core/database/repositories/customers.js";
import { recordCreditSale, recordRepayment } from "@/core/database/repositories/customerLedger.js";
import { recordStockAdjustment } from "@/core/database/repositories/inventory.js";
import { createProduct } from "@/core/database/repositories/productsAdmin.js";
import { createPurchase } from "@/core/database/repositories/purchases.js";
import { createReturn, getReturnableSale } from "@/core/database/repositories/returns.js";
import { createSale } from "@/core/database/repositories/sales.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";
import { createSupplier } from "@/core/database/repositories/suppliers.js";

describe("audit coverage", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let productId: string;
  const counterId = "counter-1";
  const deviceId = "device-1";

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

    productId = await createProduct(db, {
      storeId,
      name: "Toor Dal 1kg",
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: "0713",
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 16000,
      salePricePaise: 15000,
      costPricePaise: 7000,
      isTaxInclusive: true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function entries(action: string) {
    return listAuditLog(db, storeId, { limit: 100, action });
  }

  function saleInput(qty: number, checkStock?: (onHand: Record<string, number>) => void) {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId,
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 500,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Toor Dal 1kg",
          uom: "pcs",
          qty,
          unitPricePaise: 15000,
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
      deviceId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode: "cash" as const, amountPaise: computed.totals.netPaise, refNo: null }],
      checkStock,
    };
  }

  it("records a bill with its discount, payments and device", async () => {
    const input = saleInput(2);
    const { sale } = await createSale(db, input);

    const [entry] = await entries("sale_created");
    expect(entry?.recordId).toBe(sale.id);
    expect(entry?.deviceId).toBe(deviceId);
    expect(entry?.userName).toBe("Owner");
    expect(entry?.newValue).toMatchObject({
      billNo: sale.billNo,
      discountPaise: input.totals.discountPaise,
      netPaise: sale.netPaise,
      payments: [{ mode: "cash", amountPaise: sale.netPaise }],
    });
  });

  it("writes no audit entry for a sale that was refused", async () => {
    await createSale(db, saleInput(1));
    const refuse = (onHand: Record<string, number>) => {
      const shortfalls = findStockShortfalls([{ productId, name: "Toor Dal 1kg", qty: 99 }], onHand);
      if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);
    };

    await expect(createSale(db, saleInput(99, refuse))).rejects.toThrow(InsufficientStockError);

    // Written inside the sale's transaction, so a rolled-back sale takes its entry with it.
    expect(await entries("sale_created")).toHaveLength(1);
  });

  it("does not record a retried sale twice", async () => {
    const input = saleInput(1);
    await createSale(db, input);
    await createSale(db, input);
    expect(await entries("sale_created")).toHaveLength(1);
  });

  it("records a stock correction with the count before and after", async () => {
    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 10,
      reason: "manual_stock_in",
      note: null,
      userId,
      approvedByUserId: null,
    });
    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 7,
      reason: "adjustment_damaged",
      note: "3 packets torn",
      userId,
      approvedByUserId: null,
      deviceId,
    });

    const damaged = (await entries("stock_adjustment")).find((e) => e.reason === "3 packets torn");
    expect(damaged?.oldValue).toEqual({ qtyOnHand: 10 });
    expect(damaged?.newValue).toEqual({ qtyOnHand: 7, reason: "adjustment_damaged", approvedByUserId: null });
  });

  it("records a purchase and each cost price it changed, with the old cost", async () => {
    const supplier = await createSupplier(db, storeId, {
      name: "Madurai Traders",
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
    });
    const receive = async (costPricePaise: number, invoiceNo: string) => {
      const { lines, totals } = computePurchaseTotals([
        { productId, qty: 2, costPricePaise, taxRatePercent: 0, isTaxInclusive: false },
      ]);
      return createPurchase(db, {
        storeId,
        supplierId: supplier.id,
        invoiceNo,
        invoiceDate: "2026-09-01",
        notes: null,
        userId,
        lines,
        totals,
        updateCostPrice: true,
        deviceId,
      });
    };

    const purchase = await receive(8000, "INV-1");
    expect((await entries("purchase_received"))[0]?.recordId).toBe(purchase.id);

    const [change] = await entries("cost_price_changed");
    expect(change?.recordId).toBe(productId);
    expect(change?.oldValue).toEqual({ costPricePaise: 7000 });
    expect(change?.newValue).toEqual({
      costPricePaise: 8000,
      receivedCostPaise: 8000,
      qtyOnHandBefore: 0,
      qtyReceived: 2,
    });
    expect(change?.reason).toBe("Purchase INV-1");

    // Receiving again at the same cost changes nothing, so logs no cost change.
    await receive(8000, "INV-2");
    expect(await entries("cost_price_changed")).toHaveLength(1);
    expect(await entries("purchase_received")).toHaveLength(2);
  });

  it("records a product added through the app, and not a seeded one", async () => {
    // The product from beforeEach was created without an actor, like catalog seeding.
    expect(await entries("product_created")).toHaveLength(0);

    const id = await createProduct(db, {
      storeId,
      name: "Groundnut Oil 1L",
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 5,
      barcodes: [],
      aliases: [],
      mrpPaise: 22000,
      salePricePaise: 21000,
      costPricePaise: 18500,
      isTaxInclusive: true,
      audit: { userId, deviceId },
    });

    const [entry] = await entries("product_created");
    expect(entry?.recordId).toBe(id);
    expect(entry?.newValue).toMatchObject({ salePricePaise: 21000, costPricePaise: 18500 });
  });

  it("records a khata payment", async () => {
    const customer = await createCustomer(db, { storeId, name: "Lakshmi", phone: null, address: null });
    const { sale } = await createSale(db, { ...saleInput(1), customerId: customer.id });
    await recordCreditSale(db, { storeId, customerId: customer.id, saleId: sale.id, amountPaise: 1000, userId });

    const entry = await recordRepayment(db, {
      storeId,
      customerId: customer.id,
      amountPaise: 1000,
      paymentMode: "upi",
      note: "paid at gate",
      userId,
      deviceId,
    });

    const [logged] = await entries("credit_repayment");
    expect(logged?.recordId).toBe(entry.id);
    expect(logged?.newValue).toEqual({ customerId: customer.id, amountPaise: 1000, paymentMode: "upi" });
    expect(logged?.reason).toBe("paid at gate");
  });

  it("records a return against the bill it reverses", async () => {
    const { sale } = await createSale(db, saleInput(3));
    const returnable = await getReturnableSale(db, storeId, sale.billNo);
    const line = returnable?.lines[0];
    if (!returnable || !line) throw new Error("bill not returnable");
    const computed = computeReturnTotals([
      {
        saleItemId: line.saleItemId,
        productId: line.productId,
        soldQty: line.soldQty,
        alreadyReturnedQty: 0,
        returnQty: 1,
        discountPaise: line.discountPaise,
        taxablePaise: line.taxablePaise,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        lineTotalPaise: line.lineTotalPaise,
      },
    ]);
    const result = await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: null,
      clientTxnId: randomUUID(),
      userId,
      reason: "Weevils in packet",
      refundMode: "cash",
      lines: computed.lines,
      totals: computed.totals,
      deviceId,
    });

    const [entry] = await entries("sale_return");
    expect(entry?.recordId).toBe(result.saleReturn.id);
    expect(entry?.reason).toBe("Weevils in packet");
    expect(entry?.newValue).toMatchObject({ billNo: sale.billNo, refundPaise: computed.totals.refundPaise });
  });

  it("lists newest first, limited, and filtered by action", async () => {
    await createSale(db, saleInput(1));
    await createSale(db, saleInput(1));
    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 50,
      reason: "adjustment_correction",
      note: null,
      userId,
      approvedByUserId: null,
    });

    const all = await listAuditLog(db, storeId, { limit: 100 });
    expect(all).toHaveLength(3);
    const times = all.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    expect(await listAuditLog(db, storeId, { limit: 2 })).toHaveLength(2);
    expect(await entries("sale_created")).toHaveLength(2);

    // Another store's log is never mixed in.
    expect(await listAuditLog(db, randomUUID(), { limit: 100 })).toHaveLength(0);
  });

  // DEV2 (gap 2b): the approver is kept on the adjustment row and on its audit entry.
  it("records who approved a stock correction", async () => {
    const approverId = randomUUID();
    await db
      .insertInto("users")
      .values({ id: approverId, storeId, username: "mgr", passwordHash: "x", displayName: "Manager", role: "manager" })
      .execute();
    const adjustmentId = randomUUID();
    await recordStockAdjustment(db, {
      id: adjustmentId,
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: 4,
      reason: "adjustment_missing",
      note: null,
      userId,
      approvedByUserId: approverId,
      deviceId,
    });

    const row = await db.selectFrom("stockAdjustments").selectAll().where("id", "=", adjustmentId).executeTakeFirst();
    expect(row?.approvedByUserId).toBe(approverId);
    const [entry] = await entries("stock_adjustment");
    expect(entry?.newValue).toMatchObject({ qtyOnHand: 4, approvedByUserId: approverId });
  });

  // DEV1 (gap 3): a below-cost discount leaves its own entry, only when it was approved.
  it("records a below-cost discount approval with the sale, and nothing extra otherwise", async () => {
    await createSale(db, saleInput(1));
    expect(await entries("below_cost_discount_approved")).toHaveLength(0);

    const approved = saleInput(1);
    const { sale } = await createSale(db, { ...approved, belowCostApproval: { approvedByUserId: userId } });

    const [entry] = await entries("below_cost_discount_approved");
    expect(entry?.recordId).toBe(sale.id);
    expect(entry?.deviceId).toBe(deviceId);
    expect(entry?.newValue).toEqual({
      billNo: sale.billNo,
      discountPaise: approved.totals.discountPaise,
      approvedByUserId: userId,
    });
    const created = (await entries("sale_created")).find((e) => e.recordId === sale.id);
    expect(created?.newValue).toMatchObject({ belowCostApprovedByUserId: userId });
  });

  it("rolls back the approval entry with a refused sale", async () => {
    const refuse = () => {
      throw new InsufficientStockError([{ productId, name: "Toor Dal 1kg", requestedQty: 99, onHandQty: 0 }]);
    };
    await expect(
      createSale(db, { ...saleInput(99, refuse), belowCostApproval: { approvedByUserId: userId } }),
    ).rejects.toThrow(InsufficientStockError);
    expect(await entries("below_cost_discount_approved")).toHaveLength(0);
  });
});
