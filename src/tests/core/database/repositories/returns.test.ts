import { randomUUID } from "node:crypto";

import { computeCartTotals, computeReturnTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { createCustomer } from "@/core/database/repositories/customers.js";
import { getBalance } from "@/core/database/repositories/customerLedger.js";
import { getStock } from "@/core/database/repositories/inventory.js";
import {
  createReturn,
  findReturnByClientTxnId,
  getReturnableSale,
  listRecentReturns,
  RefundToKhataWithoutCustomerError,
} from "@/core/database/repositories/returns.js";
import { createSale } from "@/core/database/repositories/sales.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

describe("sale returns", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
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

    productId = randomUUID();
    await db
      .insertInto("products")
      .values({
        id: productId,
        storeId,
        name: "Rice 1kg",
        uom: "kg",
        isWeighted: 1,
        taxRatePercent: 5,
        isActive: 1,
      })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId, qtyOnHand: 100, reorderLevel: 5 }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  /** Rings up a bill of `qty` units and returns the sale plus its computed lines. */
  async function sell(qty: number, customerId: string | null, mode: "cash" | "credit" = "cash") {
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId,
      userId,
      customerId,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Rice 1kg",
          uom: "kg",
          qty,
          unitPricePaise: 6000,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode, amountPaise: computed.totals.netPaise, refNo: null }],
    });
    return { sale: result.sale, totals: computed.totals };
  }

  /** Builds return input for the whole of a looked-up bill's first line. */
  async function returnLines(billNo: string, qty: number) {
    const returnable = await getReturnableSale(db, storeId, billNo);
    if (!returnable) throw new Error("bill not found");
    const line = returnable.lines[0];
    if (!line) throw new Error("no lines");
    return {
      returnable,
      computed: computeReturnTotals([
        {
          saleItemId: line.saleItemId,
          productId: line.productId,
          soldQty: line.soldQty,
          alreadyReturnedQty: line.alreadyReturnedQty,
          returnQty: qty,
          discountPaise: line.discountPaise,
          taxablePaise: line.taxablePaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          lineTotalPaise: line.lineTotalPaise,
        },
      ]),
    };
  }

  it("puts returned stock back and records the credit note", async () => {
    const { sale } = await sell(4, null);
    await expect(getStock(db, storeId, productId)).resolves.toBe(96);

    const { returnable, computed } = await returnLines(sale.billNo, 2);
    const result = await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: null,
      clientTxnId: randomUUID(),
      userId,
      reason: "Damaged",
      refundMode: "cash",
      lines: computed.lines,
      totals: computed.totals,
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.saleReturn.refundPaise).toBe(12000);
    expect(result.saleReturn.returnNo).toMatch(/^RET\//);
    await expect(getStock(db, storeId, productId)).resolves.toBe(98);
  });

  it("keeps the original bill untouched", async () => {
    const { sale, totals } = await sell(4, null);
    const { returnable, computed } = await returnLines(sale.billNo, 2);
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

    const after = await db.selectFrom("sales").selectAll().where("id", "=", sale.id).executeTakeFirstOrThrow();
    expect(after.netPaise).toBe(totals.netPaise);
    expect(after.status).toBe("completed");
  });

  it("counts earlier returns when working out what is still returnable", async () => {
    const { sale } = await sell(4, null);
    const first = await returnLines(sale.billNo, 3);
    await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: first.returnable.saleId,
      customerId: null,
      clientTxnId: randomUUID(),
      userId,
      reason: null,
      refundMode: "cash",
      lines: first.computed.lines,
      totals: first.computed.totals,
    });

    const again = await getReturnableSale(db, storeId, sale.billNo);
    expect(again?.lines[0]?.alreadyReturnedQty).toBe(3);
    expect(again?.lines[0]?.returnableQty).toBe(1);
  });

  it("refunds to khata by reducing what the customer owes", async () => {
    const customer = await createCustomer(db, { storeId, name: "Lakshmi", phone: null, address: null });
    const { sale, totals } = await sell(4, customer.id, "credit");
    await expect(getBalance(db, customer.id)).resolves.toBe(totals.netPaise);

    const { returnable, computed } = await returnLines(sale.billNo, 2);
    expect(returnable.hadCreditPayment).toBe(true);

    await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: customer.id,
      clientTxnId: randomUUID(),
      userId,
      reason: null,
      refundMode: "credit",
      lines: computed.lines,
      totals: computed.totals,
    });

    await expect(getBalance(db, customer.id)).resolves.toBe(totals.netPaise - computed.totals.refundPaise);
  });

  it("refuses a khata refund with no customer on the bill", async () => {
    const { sale } = await sell(2, null);
    const { returnable, computed } = await returnLines(sale.billNo, 1);
    await expect(
      createReturn(db, {
        storeId,
        counterId,
        returnNoPrefix: "RET",
        saleId: returnable.saleId,
        customerId: null,
        clientTxnId: randomUUID(),
        userId,
        reason: null,
        refundMode: "credit",
        lines: computed.lines,
        totals: computed.totals,
      }),
    ).rejects.toThrow(RefundToKhataWithoutCustomerError);
  });

  it("does not refund or restock twice for the same client transaction", async () => {
    const { sale } = await sell(4, null);
    const { returnable, computed } = await returnLines(sale.billNo, 2);
    const clientTxnId = randomUUID();
    const args = {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: null,
      clientTxnId,
      userId,
      reason: null,
      refundMode: "cash" as const,
      lines: computed.lines,
      totals: computed.totals,
    };

    const first = await createReturn(db, args);
    const second = await createReturn(db, args);

    expect(second.alreadyExisted).toBe(true);
    expect(second.saleReturn.id).toBe(first.saleReturn.id);
    // 100 - 4 sold + 2 returned, counted once.
    await expect(getStock(db, storeId, productId)).resolves.toBe(98);
  });

  it("numbers returns in their own sequence, separate from bills", async () => {
    const { sale } = await sell(4, null);
    const { returnable, computed } = await returnLines(sale.billNo, 1);
    const first = await createReturn(db, {
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
    expect(first.saleReturn.returnNo).toMatch(/000001$/);

    // A bill rung up after the return must keep its own run of numbers.
    const next = await sell(1, null);
    expect(next.sale.billNo).toMatch(/-2$/);
  });

  it("lists recent returns with the bill they reverse", async () => {
    const { sale } = await sell(4, null);
    const { returnable, computed } = await returnLines(sale.billNo, 2);
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

    const recent = await listRecentReturns(db, storeId, 10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.billNo).toBe(sale.billNo);
    expect(recent[0]?.itemCount).toBe(1);
    expect(recent[0]?.userName).toBe("Owner");
  });

  it("stores and audits who approved the refund, and lists their name", async () => {
    const managerId = randomUUID();
    await db
      .insertInto("users")
      .values({ id: managerId, storeId, username: "mgr", passwordHash: "x", displayName: "Meena", role: "manager" })
      .execute();
    const { sale } = await sell(2, null);
    const { returnable, computed } = await returnLines(sale.billNo, 1);
    const result = await createReturn(db, {
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
      approvedByUserId: managerId,
    });

    const row = await db
      .selectFrom("saleReturns")
      .select("approvedByUserId")
      .where("id", "=", result.saleReturn.id)
      .executeTakeFirstOrThrow();
    expect(row.approvedByUserId).toBe(managerId);

    const audit = await db
      .selectFrom("auditLogs")
      .select("newValue")
      .where("action", "=", "sale_return")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(audit.newValue ?? "{}")).toMatchObject({ approvedByUserId: managerId });

    const [recent] = await listRecentReturns(db, storeId, 10);
    expect(recent?.approvedByName).toBe("Meena");
  });

  it("finds an existing return by its client transaction", async () => {
    const { sale } = await sell(2, null);
    const { returnable, computed } = await returnLines(sale.billNo, 1);
    const clientTxnId = randomUUID();
    await expect(findReturnByClientTxnId(db, clientTxnId)).resolves.toBeUndefined();
    const created = await createReturn(db, {
      storeId,
      counterId,
      returnNoPrefix: "RET",
      saleId: returnable.saleId,
      customerId: null,
      clientTxnId,
      userId,
      reason: null,
      refundMode: "cash",
      lines: computed.lines,
      totals: computed.totals,
    });
    const found = await findReturnByClientTxnId(db, clientTxnId);
    expect(found?.id).toBe(created.saleReturn.id);
    // Without an approver (an older caller), the column stays empty and the list says so.
    const [recent] = await listRecentReturns(db, storeId, 10);
    expect(recent?.approvedByName).toBeNull();
  });

  it("returns undefined for a bill number that does not exist", async () => {
    await expect(getReturnableSale(db, storeId, "POS/2025-26/999999")).resolves.toBeUndefined();
  });
});
