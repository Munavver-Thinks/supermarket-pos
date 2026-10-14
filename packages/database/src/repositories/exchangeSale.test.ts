import { randomUUID } from "node:crypto";

import { computeCartTotals, computeReturnTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { createCustomer } from "./customers.js";
import { getBalance } from "./customerLedger.js";
import { getStock } from "./inventory.js";
import { getReturnableSale, ReturnNoLongerAvailableError } from "./returns.js";
import { createSale } from "./sales.js";
import { seedFirstRun } from "./seed.js";

/**
 * Exercises the exchange path end to end: billingCreateSale's extra "exchange" argument maps
 * straight onto createSale's exchangeReturn input, so these tests call createSale directly
 * the same way the IPC handler does, rather than re-mocking that handler's own plumbing.
 */
describe("createSale — exchange (exchangeReturn)", () => {
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
      .values({ id: productId, storeId, name: "Rice 1kg", uom: "kg", isWeighted: 1, taxRatePercent: 5, isActive: 1 })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId, qtyOnHand: 100, reorderLevel: 5 }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  function cartFor(qty: number, customerId: string | null) {
    return {
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
  }

  /** Rings up a plain bill, the "original" one an exchange will later return against. */
  async function sell(qty: number, customerId: string | null, mode: "cash" | "credit" = "cash") {
    const cart = cartFor(qty, customerId);
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

  /** The return engine's totals for sending back `qty` of the first (only) line of `billNo`. */
  async function returnTotalsFor(billNo: string, qty: number) {
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

  it("N > R: pays the difference, refundMode is exchange, and no ledger entry is written", async () => {
    const { sale: original } = await sell(1, null); // R: returning 1kg
    const { returnable, computed: returnComputed } = await returnTotalsFor(original.billNo, 1);
    const R = returnComputed.totals.refundPaise;

    const newCart = cartFor(3, null); // N: buying 3kg, comfortably more than R
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const N = newComputed.totals.netPaise;
    expect(N).toBeGreaterThan(R);

    const result = await createSale(db, {
      storeId,
      counterId,
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

    expect(result.alreadyExisted).toBe(false);
    expect(result.exchangeReturnNo).toBeDefined();

    const saleRow = await db.selectFrom("sales").selectAll().where("id", "=", result.sale.id).executeTakeFirstOrThrow();
    expect(saleRow.netPaise).toBe(N); // the new sale's own net stays the full, undiscounted N

    const returnRow = await db
      .selectFrom("saleReturns")
      .selectAll()
      .where("returnNo", "=", result.exchangeReturnNo!)
      .executeTakeFirstOrThrow();
    expect(returnRow.refundMode).toBe("exchange");
    expect(returnRow.exchangePaise).toBe(R);
    expect(returnRow.exchangeSaleId).toBe(result.sale.id);

    // Both stock legs: 1kg came back, 3kg went out — net -2kg from the 99kg left after selling 1.
    await expect(getStock(db, storeId, productId)).resolves.toBe(100 - 1 + 1 - 3);

    const ledgerEntries = await db
      .selectFrom("customerLedgerEntries")
      .selectAll()
      .where("entryType", "=", "return_refund")
      .execute();
    expect(ledgerEntries).toHaveLength(0);
  });

  it("N < R: takes no payment and puts the payout on the ORIGINAL bill's customer", async () => {
    const originalCustomer = await createCustomer(db, { storeId, name: "Lakshmi", phone: null, address: null });
    const cartCustomer = await createCustomer(db, { storeId, name: "Ravi", phone: null, address: null });

    const { sale: original } = await sell(5, originalCustomer.id); // R: returning 5kg
    const { returnable, computed: returnComputed } = await returnTotalsFor(original.billNo, 5);
    const R = returnComputed.totals.refundPaise;

    const newCart = cartFor(1, cartCustomer.id); // N: buying only 1kg — less than R
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const N = newComputed.totals.netPaise;
    expect(N).toBeLessThan(R);

    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: cartCustomer.id,
      clientTxnId: newCart.clientTxnId,
      lines: newComputed.lines,
      totals: newComputed.totals,
      payments: [], // nothing is paid — the leftover is paid OUT instead
      exchangeReturn: {
        originalSaleId: returnable.saleId,
        returnNoPrefix: "POS-RET",
        customerId: returnable.customerId, // the ORIGINAL bill's customer, not the cart's
        reason: null,
        refundMode: "credit",
        exchangePaise: N,
        lines: returnComputed.lines,
        totals: returnComputed.totals,
        approvedByUserId: userId,
      },
    });

    expect(result.exchangeReturnNo).toBeDefined();
    const payout = R - N;

    await expect(getBalance(db, originalCustomer.id)).resolves.toBe(-payout);
    await expect(getBalance(db, cartCustomer.id)).resolves.toBe(0);

    const returnRow = await db
      .selectFrom("saleReturns")
      .selectAll()
      .where("returnNo", "=", result.exchangeReturnNo!)
      .executeTakeFirstOrThrow();
    expect(returnRow.refundMode).toBe("credit");
    expect(returnRow.exchangePaise).toBe(N);
  });

  it("retries with the same clientTxnId exactly once: one sale, one return", async () => {
    const { sale: original } = await sell(2, null);
    const { returnable, computed: returnComputed } = await returnTotalsFor(original.billNo, 1);
    const R = returnComputed.totals.refundPaise;

    const newCart = cartFor(5, null);
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const N = newComputed.totals.netPaise;

    const args = {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: newCart.clientTxnId,
      lines: newComputed.lines,
      totals: newComputed.totals,
      payments: [{ mode: "cash" as const, amountPaise: Math.max(0, N - R), refNo: null }],
      exchangeReturn: {
        originalSaleId: returnable.saleId,
        returnNoPrefix: "POS-RET",
        customerId: returnable.customerId,
        reason: null,
        refundMode: "exchange" as const,
        exchangePaise: Math.min(N, R),
        lines: returnComputed.lines,
        totals: returnComputed.totals,
        approvedByUserId: userId,
      },
    };

    const first = await createSale(db, args);
    const second = await createSale(db, args);

    expect(second.alreadyExisted).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect(second.exchangeReturnNo).toBe(first.exchangeReturnNo);

    const sales = await db.selectFrom("sales").selectAll().where("clientTxnId", "=", newCart.clientTxnId).execute();
    expect(sales).toHaveLength(1);
    const returnRows = await db
      .selectFrom("saleReturns")
      .selectAll()
      .where("exchangeSaleId", "=", first.sale.id)
      .execute();
    expect(returnRows).toHaveLength(1);
  });

  it("refuses an over-return race and writes nothing — the bill number is not consumed", async () => {
    const { sale: original } = await sell(4, null);
    const { returnable, computed: returnComputed } = await returnTotalsFor(original.billNo, 3);

    // Simulates another counter's return for 2 of the same 4 units, landing between this
    // request's read of the bill and its write — alreadyReturned(2) + requestedNow(3) > sold(4).
    const line = returnable.lines[0]!;
    await db
      .insertInto("saleReturns")
      .values({
        id: randomUUID(),
        storeId,
        counterId,
        saleId: returnable.saleId,
        returnNo: "POS-RET/race",
        clientTxnId: randomUUID(),
        userId,
        reason: null,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        discountPaise: 0,
        roundOffPaise: 0,
        refundPaise: 0,
        refundMode: "cash",
        approvedByUserId: null,
        exchangeSaleId: null,
      })
      .execute();
    const racingReturnId = await db
      .selectFrom("saleReturns")
      .select("id")
      .where("returnNo", "=", "POS-RET/race")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("saleReturnItems")
      .values({
        id: randomUUID(),
        returnId: racingReturnId.id,
        saleItemId: line.saleItemId,
        productId: line.productId,
        qty: 2,
        discountPaise: 0,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        lineTotalPaise: 0,
      })
      .execute();

    const newCart = cartFor(1, null);
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });

    await expect(
      createSale(db, {
        storeId,
        counterId,
        billNoPrefix: "POS",
        userId,
        customerId: null,
        clientTxnId: newCart.clientTxnId,
        lines: newComputed.lines,
        totals: newComputed.totals,
        payments: [{ mode: "cash", amountPaise: newComputed.totals.netPaise, refNo: null }],
        exchangeReturn: {
          originalSaleId: returnable.saleId,
          returnNoPrefix: "POS-RET",
          customerId: returnable.customerId,
          reason: null,
          refundMode: "exchange",
          exchangePaise: returnComputed.totals.refundPaise,
          lines: returnComputed.lines,
          totals: returnComputed.totals,
          approvedByUserId: userId,
        },
      }),
    ).rejects.toThrow(ReturnNoLongerAvailableError);

    const sales = await db.selectFrom("sales").selectAll().where("clientTxnId", "=", newCart.clientTxnId).execute();
    expect(sales).toHaveLength(0);

    // The bill number was never consumed: a fresh plain sale right after still gets "-2" (the
    // original sale above was "-1"), proving the failed attempt's counter increment rolled back.
    const next = await sell(1, null);
    expect(next.sale.billNo).toMatch(/-2$/);
  });

  it("a same-product swap (return 1, buy 1 of the same item) passes under the block policy", async () => {
    const { sale: original } = await sell(1, null);
    const { returnable, computed: returnComputed } = await returnTotalsFor(original.billNo, 1);

    const newCart = cartFor(1, null); // buying exactly 1kg of the same product back
    const newComputed = computeCartTotals(newCart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const R = returnComputed.totals.refundPaise;
    const N = newComputed.totals.netPaise;

    // On-hand after the original sale is 99 — a naive "block" check against that alone would
    // see 99 - 1 = 98 (fine), but the real risk is a product sold down to the wire: drop stock
    // to exactly 0 so the check only passes if the returned unit is counted as already back.
    await db.updateTable("inventory").set({ qtyOnHand: 0 }).where("productId", "=", productId).execute();

    const result = await createSale(db, {
      storeId,
      counterId,
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: newCart.clientTxnId,
      lines: newComputed.lines,
      totals: newComputed.totals,
      payments: [{ mode: "cash", amountPaise: Math.max(0, N - R), refNo: null }],
      exchangeReturn: {
        originalSaleId: returnable.saleId,
        returnNoPrefix: "POS-RET",
        customerId: returnable.customerId,
        reason: null,
        refundMode: N >= R ? "exchange" : "cash",
        exchangePaise: Math.min(N, R),
        lines: returnComputed.lines,
        totals: returnComputed.totals,
        approvedByUserId: userId,
      },
      // The "block" negative-stock policy: refuses only when the new lines would still be
      // short after accounting for stock already on hand (and, inside createSale, the
      // returned qty bumped back on before this runs).
      checkStock: (onHandByProduct) => {
        for (const l of newComputed.lines) {
          const onHand = onHandByProduct[l.productId] ?? 0;
          if (onHand < l.qty) throw new Error(`Insufficient stock for ${l.productId}`);
        }
      },
    });

    expect(result.alreadyExisted).toBe(false);
    // 0 on hand + 1 returned - 1 sold = 0.
    await expect(getStock(db, storeId, productId)).resolves.toBe(0);
  });
});
