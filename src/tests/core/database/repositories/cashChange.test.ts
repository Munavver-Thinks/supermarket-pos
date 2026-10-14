import { randomUUID } from "node:crypto";

import { computeCartTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { createCustomer } from "@/core/database/repositories/customers.js";
import { ChangeToKhataWithoutCustomerError, getBalance } from "@/core/database/repositories/customerLedger.js";
import { createSale } from "@/core/database/repositories/sales.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

/**
 * Exercises cash tendered + change on top of createSale, the same way exchangeSale.test.ts
 * exercises the exchange path — calling createSale directly with the payment legs the IPC
 * handler would have built via buildTenderPayments.
 */
describe("createSale — cash tendered + change", () => {
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
      .values({ id: productId, storeId, name: "Rice 1kg", uom: "kg", isWeighted: 0, taxRatePercent: 0, isActive: 1 })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId, qtyOnHand: 100, reorderLevel: 5 }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  function cartFor(customerId: string | null, clientTxnId = randomUUID()) {
    return {
      clientTxnId,
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
          qty: 1,
          unitPricePaise: 72000,
          isTaxInclusive: true,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
  }

  it("handback: the payment row stores both figures, and no ledger row is written", async () => {
    const cart = cartFor(null);
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    expect(computed.totals.netPaise).toBe(72000);

    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode: "cash", amountPaise: 72000, refNo: null, tenderedPaise: 75000, changeAction: "handback" }],
    });

    const payment = await db
      .selectFrom("payments")
      .selectAll()
      .where("saleId", "=", result.sale.id)
      .executeTakeFirstOrThrow();
    expect(payment).toMatchObject({ amountPaise: 72000, tenderedPaise: 75000, changeAction: "handback" });

    const ledgerRows = await db
      .selectFrom("customerLedgerEntries")
      .selectAll()
      .where("entryType", "=", "change_to_khata")
      .execute();
    expect(ledgerRows).toHaveLength(0);
  });

  it("khata: a change_to_khata ledger row of -3000 is written against this sale's customer", async () => {
    const customer = await createCustomer(db, { storeId, name: "Asha", phone: null, address: null });
    const cart = cartFor(customer.id);
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });

    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: customer.id,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode: "cash", amountPaise: 72000, refNo: null, tenderedPaise: 75000, changeAction: "khata" }],
    });

    const ledgerRow = await db
      .selectFrom("customerLedgerEntries")
      .selectAll()
      .where("entryType", "=", "change_to_khata")
      .executeTakeFirstOrThrow();
    expect(ledgerRow).toMatchObject({ customerId: customer.id, saleId: result.sale.id, amountPaise: -3000 });

    const balance = await getBalance(db, customer.id);
    expect(balance).toBe(-3000);
  });

  it("is idempotent: a retry with the same clientTxnId writes exactly one ledger row", async () => {
    const customer = await createCustomer(db, { storeId, name: "Asha", phone: null, address: null });
    const cart = cartFor(customer.id);
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const input = {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: customer.id,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [
        { mode: "cash" as const, amountPaise: 72000, refNo: null, tenderedPaise: 75000, changeAction: "khata" as const },
      ],
    };

    const first = await createSale(db, input);
    const second = await createSale(db, input);
    expect(second.alreadyExisted).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);

    const ledgerRows = await db
      .selectFrom("customerLedgerEntries")
      .selectAll()
      .where("entryType", "=", "change_to_khata")
      .execute();
    expect(ledgerRows).toHaveLength(1);
  });

  it("khata with no customer throws and writes nothing", async () => {
    const cart = cartFor(null);
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });

    await expect(
      createSale(db, {
        storeId,
        counterId,
        billNoPrefix: "POS",
        userId,
        customerId: null,
        clientTxnId: cart.clientTxnId,
        lines: computed.lines,
        totals: computed.totals,
        payments: [{ mode: "cash", amountPaise: 72000, refNo: null, tenderedPaise: 75000, changeAction: "khata" }],
      }),
    ).rejects.toThrow(ChangeToKhataWithoutCustomerError);

    const sales = await db.selectFrom("sales").selectAll().where("clientTxnId", "=", cart.clientTxnId).execute();
    expect(sales).toHaveLength(0);
    const payments = await db.selectFrom("payments").selectAll().execute();
    expect(payments).toHaveLength(0);
  });
});
