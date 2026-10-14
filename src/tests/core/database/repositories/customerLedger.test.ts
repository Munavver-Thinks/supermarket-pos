import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { createCustomer } from "@/core/database/repositories/customers.js";
import {
  CreditWithoutCustomerError,
  getBalance,
  getBalances,
  listEntries,
  listOutstanding,
  recordCreditSale,
  recordRepayment,
  setCreditLimit,
} from "@/core/database/repositories/customerLedger.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

describe("customer ledger", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let customerId: string;

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

    const customer = await createCustomer(db, {
      storeId,
      name: "Lakshmi",
      phone: "9000000001",
      address: null,
    });
    customerId = customer.id;
  });

  afterEach(async () => {
    await db.destroy();
  });

  /** Inserts a completed sale row so a ledger entry has a bill to point at. */
  async function insertSale(netPaise: number): Promise<string> {
    const saleId = randomUUID();
    await db
      .insertInto("sales")
      .values({
        id: saleId,
        storeId,
        counterId: "counter-1",
        billNo: `POS-${saleId.slice(0, 6)}`,
        clientTxnId: randomUUID(),
        userId,
        customerId,
        status: "completed",
        grossPaise: netPaise,
        discountPaise: 0,
        taxablePaise: netPaise,
        cgstPaise: 0,
        sgstPaise: 0,
        roundOffPaise: 0,
        netPaise,
      })
      .execute();
    return saleId;
  }

  it("starts every customer at a zero balance", async () => {
    // SUM over no rows is NULL in SQLite — this must read as 0, not NaN.
    await expect(getBalance(db, customerId)).resolves.toBe(0);
  });

  it("adds a credit sale to what the customer owes and pays it down again", async () => {
    await recordCreditSale(db, {
      storeId,
      customerId,
      saleId: await insertSale(50000),
      amountPaise: 50000,
      userId,
    });
    await expect(getBalance(db, customerId)).resolves.toBe(50000);

    await recordRepayment(db, {
      storeId,
      customerId,
      amountPaise: 20000,
      paymentMode: "cash",
      note: null,
      userId,
    });
    await expect(getBalance(db, customerId)).resolves.toBe(30000);
  });

  it("stores a repayment as a reduction however the amount is signed", async () => {
    await recordCreditSale(db, {
      storeId,
      customerId,
      saleId: await insertSale(10000),
      amountPaise: 10000,
      userId,
    });
    // A caller passing a negative amount must not accidentally increase the debt.
    await recordRepayment(db, {
      storeId,
      customerId,
      amountPaise: -4000,
      paymentMode: "upi",
      note: null,
      userId,
    });
    await expect(getBalance(db, customerId)).resolves.toBe(6000);
  });

  it("refuses a credit sale with no customer attached", async () => {
    await expect(
      recordCreditSale(db, {
        storeId,
        customerId: null,
        saleId: await insertSale(10000),
        amountPaise: 10000,
        userId,
      }),
    ).rejects.toThrow(CreditWithoutCustomerError);
  });

  it("ignores a bill with no credit portion", async () => {
    await recordCreditSale(db, {
      storeId,
      customerId: null,
      saleId: await insertSale(10000),
      amountPaise: 0,
      userId,
    });
    await expect(getBalance(db, customerId)).resolves.toBe(0);
  });

  it("writes at most one ledger entry per sale", async () => {
    const saleId = await insertSale(10000);
    const entry = { storeId, customerId, saleId, amountPaise: 10000, userId };
    await recordCreditSale(db, entry);
    // A retry that got past createSale's idempotency guard must not double the debt.
    await expect(recordCreditSale(db, entry)).rejects.toThrow();
    await expect(getBalance(db, customerId)).resolves.toBe(10000);
  });

  it("carries the bill number onto entries that came from a sale", async () => {
    const saleId = await insertSale(10000);
    await recordCreditSale(db, { storeId, customerId, saleId, amountPaise: 10000, userId });
    await recordRepayment(db, {
      storeId,
      customerId,
      amountPaise: 10000,
      paymentMode: "cash",
      note: "settled",
      userId,
    });

    const entries = await listEntries(db, customerId, 10);
    expect(entries).toHaveLength(2);

    const sale = entries.find((e) => e.entryType === "credit_sale");
    const repayment = entries.find((e) => e.entryType === "repayment");
    expect(sale?.billNo).toMatch(/^POS-/);
    expect(repayment?.billNo).toBeNull();
    expect(repayment?.paymentMode).toBe("cash");
    expect(repayment?.note).toBe("settled");
  });

  it("lists only customers still carrying a balance, largest first", async () => {
    const settled = await createCustomer(db, { storeId, name: "Settled", phone: null, address: null });
    const big = await createCustomer(db, { storeId, name: "Big", phone: null, address: null });

    await recordCreditSale(db, {
      storeId,
      customerId,
      saleId: await insertSale(5000),
      amountPaise: 5000,
      userId,
    });
    await recordCreditSale(db, {
      storeId,
      customerId: big.id,
      saleId: await insertSale(90000),
      amountPaise: 90000,
      userId,
    });
    await recordCreditSale(db, {
      storeId,
      customerId: settled.id,
      saleId: await insertSale(7000),
      amountPaise: 7000,
      userId,
    });
    await recordRepayment(db, {
      storeId,
      customerId: settled.id,
      amountPaise: 7000,
      paymentMode: "cash",
      note: null,
      userId,
    });

    const outstanding = await listOutstanding(db, storeId);
    expect(outstanding.map((o) => o.name)).toEqual(["Big", "Lakshmi"]);
    expect(outstanding[0]?.balancePaise).toBe(90000);
  });

  it("reads balances for many customers in one query", async () => {
    const other = await createCustomer(db, { storeId, name: "Other", phone: null, address: null });
    await recordCreditSale(db, {
      storeId,
      customerId,
      saleId: await insertSale(5000),
      amountPaise: 5000,
      userId,
    });

    const balances = await getBalances(db, [customerId, other.id]);
    expect(balances.get(customerId)).toBe(5000);
    // A customer with no entries is absent rather than present-with-garbage.
    expect(balances.get(other.id)).toBeUndefined();
    await expect(getBalances(db, [])).resolves.toEqual(new Map());
  });

  it("defaults the credit limit to zero and stores one when set", async () => {
    const before = await db
      .selectFrom("customers")
      .select("creditLimitPaise")
      .where("id", "=", customerId)
      .executeTakeFirstOrThrow();
    expect(before.creditLimitPaise).toBe(0);

    await setCreditLimit(db, customerId, 500000);
    const after = await db
      .selectFrom("customers")
      .select("creditLimitPaise")
      .where("id", "=", customerId)
      .executeTakeFirstOrThrow();
    expect(after.creditLimitPaise).toBe(500000);
  });
});
