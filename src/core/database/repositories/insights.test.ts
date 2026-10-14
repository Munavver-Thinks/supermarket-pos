import { randomUUID } from "node:crypto";

import { buildMarginRows, computeCartTotals, computePurchaseTotals, computeReturnTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { createCustomer } from "./customers.js";
import { getLowStock, recordStockAdjustment } from "./inventory.js";
import {
  getDashboardSummary,
  getDeadStock,
  getExpiryReport,
  getProfitReport,
  getSlowMovingStock,
  listCurrentPrices,
} from "./insights.js";
import { changeProductPrices, createProduct } from "./productsAdmin.js";
import { createPurchase } from "./purchases.js";
import { createReturn, getReturnableSale } from "./returns.js";
import { createSale } from "./sales.js";
import { seedFirstRun } from "./seed.js";
import { createSupplier } from "./suppliers.js";

const RANGE = { fromIso: "2026-09-01T00:00:00.000Z", toIso: "2026-10-01T00:00:00.000Z" };

describe("insights", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
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
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function product(
    name: string,
    prices: { sale: number; cost: number; tax?: number },
    options: { createdAt?: string; pricesFrom?: string; stock?: number; reorderLevel?: number } = {},
  ): Promise<string> {
    const id = await createProduct(db, {
      storeId,
      name,
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: prices.tax ?? 0,
      barcodes: [],
      aliases: [],
      mrpPaise: prices.sale,
      salePricePaise: prices.sale,
      costPricePaise: prices.cost,
      isTaxInclusive: true,
      reorderLevel: options.reorderLevel,
    });
    await db
      .updateTable("products")
      .set({ createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z" })
      .where("id", "=", id)
      .execute();
    await db
      .updateTable("productPrices")
      .set({ effectiveFrom: options.pricesFrom ?? "2026-01-01T00:00:00.000Z" })
      .where("productId", "=", id)
      .execute();
    if (options.stock !== undefined) {
      await recordStockAdjustment(db, {
        id: randomUUID(),
        ledgerId: randomUUID(),
        storeId,
        productId: id,
        qtyAfter: options.stock,
        reason: "manual_stock_in",
        note: null,
        userId,
        approvedByUserId: userId,
      });
    }
    return id;
  }

  async function sell(
    lines: Array<{ productId: string; qty: number; price: number; tax?: number }>,
    atIso: string,
    customerId: string | null = null,
  ) {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId,
      userId,
      customerId,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: lines.map((l) => ({
        lineId: randomUUID(),
        productId: l.productId,
        name: "x",
        uom: "pcs",
        qty: l.qty,
        unitPricePaise: l.price,
        isTaxInclusive: true,
        taxRatePercent: l.tax ?? 0,
        discountPercent: 0,
        discountFlatPaise: 0,
      })),
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const { sale } = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [
        customerId
          ? { mode: "upi" as const, amountPaise: computed.totals.netPaise, refNo: null }
          : { mode: "cash" as const, amountPaise: computed.totals.netPaise, refNo: null },
      ],
      expiryToday: atIso.slice(0, 10),
    });
    await db.updateTable("sales").set({ createdAt: atIso }).where("id", "=", sale.id).execute();
    return sale;
  }

  it("works out profit at cost: a ₹150 sale of a ₹70 item makes ₹80", async () => {
    const dal = await product("Toor Dal", { sale: 15000, cost: 7000 });
    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-10T05:00:00.000Z");

    const report = await getProfitReport(db, storeId, RANGE);
    expect(report).toMatchObject({ taxablePaise: 15000, costPaise: 7000, profitPaise: 8000, productsWithoutCost: 0 });
    expect(report.rows).toEqual([
      {
        productId: dal,
        name: "Toor Dal",
        uom: "pcs",
        qtySold: 1,
        taxablePaise: 15000,
        costPaise: 7000,
        profitPaise: 8000,
        marginPercent: 53.3,
        hasCost: true,
      },
    ]);
  });

  it("costs each sale at the price in effect when it was made", async () => {
    const dal = await product("Toor Dal", { sale: 15000, cost: 7000 });
    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-05T05:00:00.000Z");

    // Cost goes up after the first sale; the history row is closed, not overwritten.
    await changeProductPrices(
      db,
      dal,
      { mrpPaise: 15000, salePricePaise: 15000, costPricePaise: 9000, isTaxInclusive: true },
      { storeId, userId, deviceId: null },
    );
    const now = "2026-09-08T00:00:00.000Z";
    await db
      .updateTable("productPrices")
      .set({ effectiveTo: now })
      .where("productId", "=", dal)
      .where("effectiveTo", "is not", null)
      .execute();
    await db
      .updateTable("productPrices")
      .set({ effectiveFrom: now })
      .where("productId", "=", dal)
      .where("effectiveTo", "is", null)
      .execute();
    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-12T05:00:00.000Z");

    const report = await getProfitReport(db, storeId, RANGE);
    expect(report.costPaise).toBe(7000 + 9000);
    expect(report.profitPaise).toBe(30000 - 16000);

    // A later cost change doesn't touch the first sale's profit.
    const firstWeek = await getProfitReport(db, storeId, {
      fromIso: "2026-09-01T00:00:00.000Z",
      toIso: "2026-09-07T00:00:00.000Z",
    });
    expect(firstWeek.profitPaise).toBe(8000);
  });

  it("nets returns off at the original sale's cost and keeps totals equal to the rows", async () => {
    const dal = await product("Toor Dal", { sale: 15000, cost: 7000 });
    const oil = await product("Oil", { sale: 21000, cost: 18000, tax: 5 });
    const sale = await sell(
      [
        { productId: dal, qty: 3, price: 15000 },
        { productId: oil, qty: 2, price: 21000, tax: 5 },
      ],
      "2026-09-10T05:00:00.000Z",
    );

    const returnable = await getReturnableSale(db, storeId, sale.billNo);
    const line = returnable?.lines.find((l) => l.productId === dal);
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
    const { saleReturn } = await createReturn(db, {
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
    await db.updateTable("saleReturns").set({ createdAt: "2026-09-11T05:00:00.000Z" }).where("id", "=", saleReturn.id).execute();

    const report = await getProfitReport(db, storeId, RANGE);
    const dalRow = report.rows.find((r) => r.productId === dal);
    expect(dalRow).toMatchObject({ qtySold: 2, taxablePaise: 30000, costPaise: 14000, profitPaise: 16000 });
    const oilRow = report.rows.find((r) => r.productId === oil);
    // ₹210 incl. 5% → ₹200 taxable each.
    expect(oilRow).toMatchObject({ qtySold: 2, taxablePaise: 40000, costPaise: 36000, profitPaise: 4000 });

    expect(report.profitPaise).toBe(report.rows.reduce((sum, r) => sum + r.profitPaise, 0));
    expect(report.taxablePaise).toBe(report.rows.reduce((sum, r) => sum + r.taxablePaise, 0));
  });

  it("counts a product with no cost as zero cost and flags it", async () => {
    const salt = await product("Salt", { sale: 2000, cost: 0 });
    await sell([{ productId: salt, qty: 2, price: 2000 }], "2026-09-10T05:00:00.000Z");
    const report = await getProfitReport(db, storeId, RANGE);
    expect(report.productsWithoutCost).toBe(1);
    expect(report.rows[0]).toMatchObject({ costPaise: 0, profitPaise: 4000, hasCost: false });
  });

  it("finds slow-moving stock by days of cover", async () => {
    const asOfIso = "2026-09-30T00:00:00.000Z";
    // 100 on hand, 3 sold in 30 days → 1,000 days of cover.
    const slow = await product("Asafoetida", { sale: 5000, cost: 4000 }, { stock: 103 });
    // 30 on hand, 30 sold in 30 days → 30 days of cover: fine.
    const fast = await product("Milk", { sale: 3000, cost: 2500 }, { stock: 60 });
    // Nothing sold: dead, not slow.
    await product("Dusty", { sale: 1000, cost: 800 }, { stock: 5 });
    await sell([{ productId: slow, qty: 3, price: 5000 }], "2026-09-20T05:00:00.000Z");
    await sell([{ productId: fast, qty: 30, price: 3000 }], "2026-09-21T05:00:00.000Z");

    const rows = await getSlowMovingStock(db, storeId, { asOfIso, lookbackDays: 30, minCoverDays: 60 });
    expect(rows).toEqual([
      {
        productId: slow,
        name: "Asafoetida",
        uom: "pcs",
        qtyOnHand: 100,
        qtySold: 3,
        daysOfCover: 1000,
        valuePaise: 400000,
      },
    ]);
  });

  it("finds dead stock: in the shop a while, stock on hand, no sale in the window", async () => {
    const asOfIso = "2026-09-30T00:00:00.000Z";
    const dead = await product("Dusty Jar", { sale: 1000, cost: 800 }, { stock: 5 });
    const soldLongAgo = await product("Old Tin", { sale: 1000, cost: 500 }, { stock: 10 });
    const selling = await product("Rice", { sale: 6000, cost: 5000 }, { stock: 10 });
    await product("New Item", { sale: 1000, cost: 500 }, { stock: 10, createdAt: "2026-09-25T00:00:00.000Z" });
    await product("Empty Shelf", { sale: 1000, cost: 500 }, { stock: 0 });
    await sell([{ productId: soldLongAgo, qty: 1, price: 1000 }], "2026-03-01T05:00:00.000Z");
    await sell([{ productId: selling, qty: 1, price: 6000 }], "2026-09-20T05:00:00.000Z");

    const rows = await getDeadStock(db, storeId, { asOfIso, days: 90 });
    expect(rows.map((r) => [r.name, r.qtyOnHand, r.valuePaise, r.lastSoldAt])).toEqual([
      ["Old Tin", 9, 4500, "2026-03-01T05:00:00.000Z"],
      ["Dusty Jar", 5, 4000, null],
    ]);
    expect(rows[1]?.productId).toBe(dead);
    expect(rows.map((r) => r.productId)).not.toContain(selling);
  });

  it("lists current prices for the margin report, with below-cost and no-cost flags", async () => {
    await product("Rice", { sale: 6000, cost: 5000 });
    await product("Oil", { sale: 9000, cost: 10000 });
    await product("Salt", { sale: 2000, cost: 0 });
    const inactive = await product("Old", { sale: 100, cost: 1000 });
    await db.updateTable("products").set({ isActive: 0 }).where("id", "=", inactive).execute();

    const rows = buildMarginRows(await listCurrentPrices(db, storeId));
    expect(rows.map((r) => [r.name, r.belowCost, r.noCost])).toEqual([
      ["Oil", true, false],
      ["Rice", false, false],
      ["Salt", false, true],
    ]);
  });

  it("builds the dashboard from the same queries as the detail screens", async () => {
    const today = "2026-09-16";
    const startIso = "2026-09-15T18:30:00.000Z";
    const dal = await product("Toor Dal", { sale: 15000, cost: 7000 }, { stock: 12, reorderLevel: 5 });
    await product("Sugar", { sale: 4500, cost: 4000 }, { stock: 3, reorderLevel: 5 });
    await product("Atta", { sale: 4500, cost: 4000 });
    const supplier = await createSupplier(db, storeId, {
      name: "Balaji",
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
    });
    const { lines, totals } = computePurchaseTotals([
      { productId: dal, qty: 4, costPricePaise: 7000, taxRatePercent: 0, isTaxInclusive: false, expiryDate: "2026-09-10" },
      // Sales draw from this in-date batch first, so it needs more than the three sold below.
      { productId: dal, qty: 5, costPricePaise: 7000, taxRatePercent: 0, isTaxInclusive: false, expiryDate: "2026-09-30" },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId: supplier.id,
      invoiceNo: "INV-1",
      invoiceDate: today,
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });
    const lakshmi = await createCustomer(db, { storeId, name: "Lakshmi", phone: null, address: null });
    await createCustomer(db, { storeId, name: "Ravi", phone: null, address: null });

    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-16T04:00:00.000Z", lakshmi.id);
    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-16T05:00:00.000Z", lakshmi.id);
    await sell([{ productId: dal, qty: 1, price: 15000 }], "2026-09-14T05:00:00.000Z");

    const summary = await getDashboardSummary(db, storeId, { startIso, today, alertDays: 30, includeProfit: true });
    expect(summary).toMatchObject({
      netPaise: 30000,
      billCount: 2,
      refundPaise: 0,
      grossProfitPaise: 16000,
      productsWithoutCost: 0,
      expiringCount: 1,
      expiredCount: 1,
      customerCount: 2,
      customersServedToday: 1,
    });
    expect(summary.paymentMix).toEqual([{ mode: "upi", amountPaise: 30000 }]);
    expect(summary.lowStockCount).toBe((await getLowStock(db, storeId)).length);
    expect(summary.lowStockCount).toBe(2);
    expect((await getExpiryReport(db, storeId, today, 30)).length).toBe(2);

    const cashierView = await getDashboardSummary(db, storeId, { startIso, today, alertDays: 30, includeProfit: false });
    expect(cashierView.grossProfitPaise).toBeNull();
    expect(cashierView.productsWithoutCost).toBeNull();
  });
});
