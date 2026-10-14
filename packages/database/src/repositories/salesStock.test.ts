import { randomUUID } from "node:crypto";

import { computeCartTotals, findStockShortfalls, InsufficientStockError } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { getStock, getStockLevels } from "./inventory.js";
import { createSale } from "./sales.js";
import { seedFirstRun } from "./seed.js";

describe("createSale stock check", () => {
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
      .values({ id: productId, storeId, name: "Oil 1L", uom: "pcs", taxRatePercent: 5, isActive: 1 })
      .execute();
    await db.insertInto("inventory").values({ storeId, productId, qtyOnHand: 3, reorderLevel: 1 }).execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  function saleInput(qty: number, checkStock?: (onHand: Record<string, number>) => void) {
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
          name: "Oil 1L",
          uom: "pcs",
          qty,
          unitPricePaise: 15000,
          isTaxInclusive: true,
          taxRatePercent: 5,
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
    };
  }

  /** The rule the main process passes when the store's policy is "block". */
  function blockOnShortfall(lines: Array<{ productId: string; name: string; qty: number }>) {
    return (onHand: Record<string, number>) => {
      const shortfalls = findStockShortfalls(lines, onHand);
      if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);
    };
  }

  it("refuses a sale the check rejects and writes nothing", async () => {
    const input = saleInput(5, blockOnShortfall([{ productId, name: "Oil 1L", qty: 5 }]));

    await expect(createSale(db, input)).rejects.toThrow(InsufficientStockError);

    await expect(getStock(db, storeId, productId)).resolves.toBe(3);
    const sales = await db.selectFrom("sales").select("id").execute();
    expect(sales).toHaveLength(0);
  });

  it("does not use up a bill number on a refused sale", async () => {
    await expect(
      createSale(db, saleInput(5, blockOnShortfall([{ productId, name: "Oil 1L", qty: 5 }]))),
    ).rejects.toThrow();

    // The next real bill must still be number one — a refused sale leaves no gap.
    const ok = await createSale(db, saleInput(1));
    expect(ok.sale.billNo).toMatch(/-1$/);
  });

  it("lets a sale through when the check passes", async () => {
    const result = await createSale(db, saleInput(3, blockOnShortfall([{ productId, name: "Oil 1L", qty: 3 }])));
    expect(result.alreadyExisted).toBe(false);
    await expect(getStock(db, storeId, productId)).resolves.toBe(0);
  });

  it("still allows going below zero when no check is given", async () => {
    // The allow and warn policies pass no check — the sale must go through as before.
    await createSale(db, saleInput(5));
    await expect(getStock(db, storeId, productId)).resolves.toBe(-2);
  });

  it("hands the check the stock as it stands inside the transaction", async () => {
    let seen: Record<string, number> | undefined;
    await createSale(
      db,
      saleInput(1, (onHand) => {
        seen = onHand;
      }),
    );
    expect(seen).toEqual({ [productId]: 3 });
  });
});

describe("getStockLevels", () => {
  let db: Db;
  let storeId: string;

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
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("reports every requested product, zero where there is no stock row", async () => {
    const stocked = randomUUID();
    const unstocked = randomUUID();
    for (const id of [stocked, unstocked]) {
      await db
        .insertInto("products")
        .values({ id, storeId, name: id, uom: "pcs", taxRatePercent: 0, isActive: 1 })
        .execute();
    }
    await db.insertInto("inventory").values({ storeId, productId: stocked, qtyOnHand: 7, reorderLevel: 0 }).execute();

    // Present-with-zero is what lets the cart tell "out of stock" from "not loaded yet".
    await expect(getStockLevels(db, storeId, [stocked, unstocked])).resolves.toEqual({
      [stocked]: 7,
      [unstocked]: 0,
    });
    await expect(getStockLevels(db, storeId, [])).resolves.toEqual({});
  });
});
