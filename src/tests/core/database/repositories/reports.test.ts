import { randomUUID } from "node:crypto";

import { computeCartTotals, computeReturnTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import {
  getGstSummary,
  getHsnSummary,
  getSalesReport,
  getStockValuation,
  getTopProducts,
  type DateRange,
} from "@/core/database/repositories/reports.js";
import { createReturn, getReturnableSale } from "@/core/database/repositories/returns.js";
import { createSale } from "@/core/database/repositories/sales.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

/** A range wide enough to contain everything these tests create. */
const WHOLE_RANGE: DateRange = { fromIso: "2000-01-01T00:00:00.000Z", toIso: "2100-01-01T00:00:00.000Z" };

describe("reports", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let riceId: string;
  let soapId: string;
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

    riceId = await addProduct("Rice 1kg", "kg", 5, "1006");
    soapId = await addProduct("Soap", "pcs", 18, "3401");
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function addProduct(name: string, uom: string, taxRatePercent: number, hsnCode: string): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto("products")
      .values({ id, storeId, name, uom, taxRatePercent, hsnCode, isActive: 1 })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId: id, qtyOnHand: 50, reorderLevel: 5 }).execute();
    await db
      .insertInto("productPrices")
      .values({
        id: randomUUID(),
        productId: id,
        mrpPaise: 10000,
        salePricePaise: 10000,
        costPricePaise: 7000,
        isTaxInclusive: 1,
        effectiveTo: null,
      })
      .execute();
    return id;
  }

  async function sell(
    items: Array<{ productId: string; name: string; uom: string; qty: number; taxRatePercent: number }>,
    mode: "cash" | "upi" = "cash",
  ) {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId,
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: items.map((i) => ({
        lineId: randomUUID(),
        productId: i.productId,
        name: i.name,
        uom: i.uom,
        qty: i.qty,
        unitPricePaise: 10000,
        isTaxInclusive: true,
        taxRatePercent: i.taxRatePercent,
        discountPercent: 0,
        discountFlatPaise: 0,
      })),
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode, amountPaise: computed.totals.netPaise, refNo: null }],
    });
    return { sale: result.sale, totals: computed.totals };
  }

  it("sums bills over the range with a payment breakdown", async () => {
    await sell([{ productId: riceId, name: "Rice 1kg", uom: "kg", qty: 2, taxRatePercent: 5 }], "cash");
    await sell([{ productId: soapId, name: "Soap", uom: "pcs", qty: 1, taxRatePercent: 18 }], "upi");

    const report = await getSalesReport(db, storeId, WHOLE_RANGE);
    expect(report.billCount).toBe(2);
    expect(report.netPaise).toBe(30000);
    expect(report.paymentMix.find((p) => p.mode === "cash")?.amountPaise).toBe(20000);
    expect(report.paymentMix.find((p) => p.mode === "upi")?.amountPaise).toBe(10000);
  });

  it("nets returns off revenue and tax", async () => {
    const { sale } = await sell([{ productId: riceId, name: "Rice 1kg", uom: "kg", qty: 4, taxRatePercent: 5 }]);
    const before = await getSalesReport(db, storeId, WHOLE_RANGE);

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

    const after = await getSalesReport(db, storeId, WHOLE_RANGE);
    // A report that ignored credit notes would report the same revenue as before.
    expect(after.netPaise).toBe(before.netPaise - computed.totals.refundPaise);
    expect(after.cgstPaise).toBe(before.cgstPaise - computed.totals.cgstPaise);
    expect(after.returnCount).toBe(1);
    expect(after.refundPaise).toBe(computed.totals.refundPaise);
  });

  it("nets an exchange to N minus R, counting only what was actually paid", async () => {
    // Original bill: 4kg rice, all of it will come back.
    const { sale: original } = await sell([{ productId: riceId, name: "Rice 1kg", uom: "kg", qty: 4, taxRatePercent: 5 }]);
    const before = await getSalesReport(db, storeId, WHOLE_RANGE);

    const returnable = await getReturnableSale(db, storeId, original.billNo);
    const line = returnable?.lines[0];
    if (!returnable || !line) throw new Error("bill not returnable");
    const returnComputed = computeReturnTotals([
      {
        saleItemId: line.saleItemId,
        productId: line.productId,
        soldQty: line.soldQty,
        alreadyReturnedQty: 0,
        returnQty: 4,
        discountPaise: line.discountPaise,
        taxablePaise: line.taxablePaise,
        cgstPaise: line.cgstPaise,
        sgstPaise: line.sgstPaise,
        lineTotalPaise: line.lineTotalPaise,
      },
    ]);
    const R = returnComputed.totals.refundPaise;

    // The new bill: 1 soap — comfortably less than R, so N < R and nothing is paid up front.
    const newCart = {
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
          productId: soapId,
          name: "Soap",
          uom: "pcs",
          qty: 1,
          unitPricePaise: 10000,
          isTaxInclusive: true,
          taxRatePercent: 18,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const N = newComputed.totals.netPaise;
    expect(N).toBeLessThan(R);

    await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: newCart.clientTxnId,
      lines: newComputed.lines,
      totals: newComputed.totals,
      payments: [], // N < R: nothing is paid, the leftover is paid out instead
      exchangeReturn: {
        originalSaleId: returnable.saleId,
        returnNoPrefix: "POS-RET",
        customerId: returnable.customerId,
        reason: null,
        refundMode: "cash",
        exchangePaise: N,
        lines: returnComputed.lines,
        totals: returnComputed.totals,
        approvedByUserId: userId,
      },
    });

    const after = await getSalesReport(db, storeId, WHOLE_RANGE);
    // The new sale's own netPaise stays the full N; the return's refundPaise stays the full R.
    // Netted, the two bills together should read as (before.net + N) - R.
    expect(after.netPaise).toBe(before.netPaise + N - R);
    expect(after.billCount).toBe(2);
    expect(after.returnCount).toBe(1);

    // No payment row was written for the new sale (nothing was paid) — the payout to the
    // customer is a ledger/cash event, never counted as revenue received.
    const cashBefore = before.paymentMix.find((p) => p.mode === "cash")?.amountPaise ?? 0;
    const cashAfter = after.paymentMix.find((p) => p.mode === "cash")?.amountPaise ?? 0;
    expect(cashAfter).toBe(cashBefore);
  });

  it("excludes bills outside the range", async () => {
    await sell([{ productId: riceId, name: "Rice 1kg", uom: "kg", qty: 1, taxRatePercent: 5 }]);
    const empty = await getSalesReport(db, storeId, {
      fromIso: "2000-01-01T00:00:00.000Z",
      toIso: "2000-01-02T00:00:00.000Z",
    });
    expect(empty.billCount).toBe(0);
    // Sums over nothing must read as 0, not NaN.
    expect(empty.netPaise).toBe(0);
    expect(empty.cgstPaise).toBe(0);
  });

  it("groups tax by rate for a GSTR-1 return", async () => {
    await sell([
      { productId: riceId, name: "Rice 1kg", uom: "kg", qty: 2, taxRatePercent: 5 },
      { productId: soapId, name: "Soap", uom: "pcs", qty: 1, taxRatePercent: 18 },
    ]);

    const rows = await getGstSummary(db, storeId, WHOLE_RANGE);
    expect(rows.map((r) => r.taxRatePercent)).toEqual([5, 18]);

    const five = rows[0];
    expect(five?.cgstPaise).toBeGreaterThan(0);
    // CGST and SGST are always half each of the total tax.
    expect(five?.totalTaxPaise).toBe((five?.cgstPaise ?? 0) + (five?.sgstPaise ?? 0));
    expect(five?.cgstPaise).toBe(five?.sgstPaise);
  });

  it("subtracts returns from the rate they were sold at", async () => {
    const { sale } = await sell([{ productId: soapId, name: "Soap", uom: "pcs", qty: 2, taxRatePercent: 18 }]);
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

    const rows = await getGstSummary(db, storeId, WHOLE_RANGE);
    const eighteen = rows.find((r) => r.taxRatePercent === 18);
    // Everything sold at 18% came back, so the band nets to nothing.
    expect(eighteen?.taxablePaise).toBe(0);
    expect(eighteen?.totalTaxPaise).toBe(0);
  });

  it("summarises by HSN code", async () => {
    await sell([
      { productId: riceId, name: "Rice 1kg", uom: "kg", qty: 3, taxRatePercent: 5 },
      { productId: soapId, name: "Soap", uom: "pcs", qty: 1, taxRatePercent: 18 },
    ]);

    const rows = await getHsnSummary(db, storeId, WHOLE_RANGE);
    expect(rows.map((r) => r.hsnCode)).toEqual(["1006", "3401"]);
    expect(rows[0]?.qty).toBe(3);
    expect(rows[0]?.taxRatePercent).toBe(5);
  });

  it("ranks top products by money taken", async () => {
    await sell([{ productId: riceId, name: "Rice 1kg", uom: "kg", qty: 1, taxRatePercent: 5 }]);
    await sell([{ productId: soapId, name: "Soap", uom: "pcs", qty: 5, taxRatePercent: 18 }]);

    const top = await getTopProducts(db, storeId, WHOLE_RANGE, 10);
    expect(top[0]?.name).toBe("Soap");
    expect(top[0]?.qty).toBe(5);
    expect(top[0]?.revenuePaise).toBe(50000);
  });

  it("values stock at its open cost price, largest first", async () => {
    const rows = await getStockValuation(db, storeId);
    expect(rows).toHaveLength(2);
    // 50 on hand at ₹70 cost.
    expect(rows[0]?.valuePaise).toBe(350000);
  });

  it("counts a product with no cost price as zero rather than dropping it", async () => {
    const freebieId = randomUUID();
    await db
      .insertInto("products")
      .values({ id: freebieId, storeId, name: "Carry bag", uom: "pcs", taxRatePercent: 0, isActive: 1 })
      .execute();
    await db
      .insertInto("inventory")
      .values({ storeId, productId: freebieId, qtyOnHand: 10, reorderLevel: 0 })
      .execute();

    const rows = await getStockValuation(db, storeId);
    const bag = rows.find((r) => r.name === "Carry bag");
    // Present with a zero value — a missing price must not silently shrink the quantity column.
    expect(bag).toBeDefined();
    expect(bag?.qtyOnHand).toBe(10);
    expect(bag?.valuePaise).toBe(0);
  });
});
