import { randomUUID } from "node:crypto";

import { computeCartTotals, computeReturnTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { createCustomer } from "./customers.js";
import { getInvoiceData, hasBeenPrinted, logSuccessfulPrint } from "./invoices.js";
import { getReturnableSale } from "./returns.js";
import { createSale } from "./sales.js";
import { seedFirstRun } from "./seed.js";

describe("invoices", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let productId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Murugan Stores",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    userId = seed.ownerUserId;
    await db
      .updateTable("stores")
      .set({ address: "1 Main Road", gstin: "33AAAAA0000A1Z5", stateCode: "33" })
      .where("id", "=", storeId)
      .execute();

    productId = randomUUID();
    await db
      .insertInto("products")
      .values({
        id: productId,
        storeId,
        name: "Sunflower Oil 1L",
        nameTamil: "சூரியகாந்தி எண்ணெய்",
        hsnCode: "1512",
        uom: "pcs",
        isWeighted: 0,
        taxRatePercent: 5,
        isActive: 1,
      })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId, qtyOnHand: 50, reorderLevel: 0 }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function sell(customerId: string | null) {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId: "counter-1",
      userId,
      customerId,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Sunflower Oil 1L",
          uom: "pcs",
          qty: 2,
          unitPricePaise: 21000,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const { sale } = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [
        { mode: "cash", amountPaise: 20000, refNo: null },
        { mode: "upi", amountPaise: computed.totals.netPaise - 20000, refNo: "UTR1" },
      ],
    });
    return sale;
  }

  it("reads everything the invoice prints from the saved bill", async () => {
    const customer = await createCustomer(db, { storeId, name: "Lakshmi", phone: "98400", address: "Car St" });
    const sale = await sell(customer.id);

    const data = await getInvoiceData(db, sale.id);
    expect(data?.sale.billNo).toBe(sale.billNo);
    expect(data?.store).toEqual({ name: "Murugan Stores", address: "1 Main Road", gstin: "33AAAAA0000A1Z5", stateCode: "33" });
    expect(data?.customer).toEqual({ name: "Lakshmi", phone: "98400", address: "Car St" });
    expect(data?.cashierName).toBe("Owner");
    expect(data?.items).toHaveLength(1);
    expect(data?.items[0]).toMatchObject({
      name: "Sunflower Oil 1L",
      nameTamil: "சூரியகாந்தி எண்ணெய்",
      hsnCode: "1512",
      uom: "pcs",
      qty: 2,
      taxRatePercent: 5,
    });
    const item = data?.items[0];
    expect((item?.cgstPaise ?? 0) + (item?.sgstPaise ?? 0) + (item?.taxablePaise ?? 0)).toBe(item?.lineTotalPaise);
    expect(data?.payments.map((p) => p.mode)).toEqual(["cash", "upi"]);
    expect(data?.payments.reduce((s, p) => s + p.amountPaise, 0)).toBe(sale.netPaise);
  });

  it("round-trips tenderedPaise/changeAction on the cash leg, and omits them when absent", async () => {
    const plain = await sell(null);
    const plainData = await getInvoiceData(db, plain.id);
    const plainCash = plainData?.payments.find((p) => p.mode === "cash");
    expect(plainCash?.tenderedPaise ?? null).toBeNull();
    expect(plainCash?.changeAction ?? null).toBeNull();

    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId: "counter-1",
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Sunflower Oil 1L",
          uom: "pcs",
          qty: 2,
          unitPricePaise: 21000,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const { sale } = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [
        {
          mode: "cash",
          amountPaise: computed.totals.netPaise,
          refNo: null,
          tenderedPaise: computed.totals.netPaise + 3000,
          changeAction: "handback",
        },
      ],
    });

    const data = await getInvoiceData(db, sale.id);
    const cashLeg = data?.payments.find((p) => p.mode === "cash");
    expect(cashLeg).toMatchObject({ tenderedPaise: computed.totals.netPaise + 3000, changeAction: "handback" });
  });

  it("has no customer for a walk-in bill, and nothing for an unknown sale", async () => {
    const sale = await sell(null);
    expect((await getInvoiceData(db, sale.id))?.customer).toBeNull();
    expect(await getInvoiceData(db, randomUUID())).toBeUndefined();
  });

  it("has no exchangeReturn for a plain sale", async () => {
    const sale = await sell(null);
    expect((await getInvoiceData(db, sale.id))?.exchangeReturn).toBeFalsy();
  });

  it("populates exchangeReturn for a sale that took back items from an earlier bill", async () => {
    const original = await sell(null); // 2 pcs of the oil, sold for cash+upi

    const returnable = await getReturnableSale(db, storeId, original.billNo);
    const line = returnable?.lines[0];
    if (!returnable || !line) throw new Error("bill not returnable");
    const returnComputed = computeReturnTotals([
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
    const R = returnComputed.totals.refundPaise;

    const newCart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId: "counter-1",
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Sunflower Oil 1L",
          uom: "pcs",
          qty: 3,
          unitPricePaise: 21000,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const N = newComputed.totals.netPaise;
    expect(N).toBeGreaterThan(R);

    const { sale: newSale, exchangeReturnNo } = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: newCart.clientTxnId,
      lines: newComputed.lines,
      totals: newComputed.totals,
      payments: [{ mode: "cash", amountPaise: N - R, refNo: null }],
      exchangeReturn: {
        originalSaleId: returnable.saleId,
        returnNoPrefix: "POS-RET",
        customerId: returnable.customerId,
        reason: null,
        refundMode: "exchange",
        exchangePaise: R,
        lines: returnComputed.lines,
        totals: returnComputed.totals,
        approvedByUserId: userId,
      },
    });

    const data = await getInvoiceData(db, newSale.id);
    expect(data?.exchangeReturn).toMatchObject({
      returnNo: exchangeReturnNo,
      originalBillNo: original.billNo,
      refundPaise: R,
      roundOffPaise: returnComputed.totals.roundOffPaise,
      exchangePaise: R,
      payoutPaise: 0,
      payoutMode: null,
    });
    expect(data?.exchangeReturn?.lines).toEqual([
      { name: "Sunflower Oil 1L", nameTamil: "சூரியகாந்தி எண்ணெய்", qty: 1, uom: "pcs", amountPaise: returnComputed.lines[0]?.lineTotalPaise },
    ]);
  });

  it("treats only copies after the first as duplicates, and audits only those", async () => {
    const sale = await sell(null);
    expect(await hasBeenPrinted(db, sale.id)).toBe(false);

    // The first print after the sale: recorded, not audited.
    await logSuccessfulPrint(db, {
      storeId,
      saleId: sale.id,
      billNo: sale.billNo,
      format: "receipt",
      userId,
      deviceId: "device-1",
      duplicate: await hasBeenPrinted(db, sale.id),
    });
    expect(await hasBeenPrinted(db, sale.id)).toBe(true);
    const reprintsAfterFirst = await db
      .selectFrom("auditLogs")
      .selectAll()
      .where("action", "=", "receipt_reprinted")
      .execute();
    expect(reprintsAfterFirst).toHaveLength(0);

    // Any later print, in any format, is a duplicate.
    for (const format of ["a4", "pdf", "receipt"] as const) {
      await logSuccessfulPrint(db, {
        storeId,
        saleId: sale.id,
        billNo: sale.billNo,
        format,
        userId,
        deviceId: "device-1",
        duplicate: await hasBeenPrinted(db, sale.id),
      });
    }
    const prints = await db.selectFrom("receiptPrints").selectAll().where("saleId", "=", sale.id).execute();
    expect(prints.map((p) => p.format).sort()).toEqual(["a4", "pdf", "receipt", "receipt"]);

    const audits = await db
      .selectFrom("auditLogs")
      .selectAll()
      .where("action", "=", "receipt_reprinted")
      .orderBy("createdAt")
      .execute();
    expect(audits).toHaveLength(3);
    expect(audits.map((a) => JSON.parse(a.newValue ?? "{}").format).sort()).toEqual(["a4", "pdf", "receipt"]);
    expect(JSON.parse(audits[0]?.newValue ?? "{}")).toMatchObject({ billNo: sale.billNo });
    expect(audits[0]?.recordId).toBe(sale.id);
  });

  it("keeps another bill's prints separate", async () => {
    const first = await sell(null);
    const second = await sell(null);
    await logSuccessfulPrint(db, {
      storeId,
      saleId: first.id,
      billNo: first.billNo,
      format: "receipt",
      userId,
      deviceId: null,
      duplicate: false,
    });
    expect(await hasBeenPrinted(db, second.id)).toBe(false);
  });
});
