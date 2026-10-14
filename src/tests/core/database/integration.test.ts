import { randomUUID } from "node:crypto";

import { computeCartTotals } from "@pos/business-logic";
import type { Cart } from "@pos/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { createProduct } from "@/core/database/repositories/productsAdmin.js";
import { createSale } from "@/core/database/repositories/sales.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";
import { getStock } from "@/core/database/repositories/inventory.js";

describe("database integration", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let productId: string;

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
      name: "Aachi Chilli Powder 200g",
      nameTamil: null,
      shortCode: "ACP200",
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 5,
      barcodes: ["8901234567890"],
      aliases: ["aachi milagai"],
      mrpPaise: 5000,
      salePricePaise: 4500,
      costPricePaise: 3500,
      isTaxInclusive: true,
    });

    // Give the product some opening stock via a direct movement, simulating stock-in.
    await db
      .updateTable("inventory")
      .set({ qtyOnHand: 100 })
      .where("productId", "=", productId)
      .where("storeId", "=", storeId)
      .execute();
  });

  afterEach(async () => {
    await db.destroy();
  });

  function buildCart(qty: number): Cart {
    return {
      clientTxnId: randomUUID(),
      storeId,
      counterId: "counter-1",
      userId,
      customerId: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Aachi Chilli Powder 200g",
          uom: "pcs",
          qty,
          unitPricePaise: 4500,
          isTaxInclusive: true,
          taxRatePercent: 5,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
    };
  }

  it("creates a sale, decrements stock, and assigns a bill number", async () => {
    const cart = buildCart(2);
    const { totals, lines } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: false });

    const result = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines,
      totals,
      payments: [{ mode: "cash", amountPaise: totals.netPaise, refNo: null }],
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.sale.billNo).toMatch(/^POS-\d{8}-\d+$/);
    expect(result.sale.netPaise).toBe(totals.netPaise);

    const stock = await getStock(db, storeId, productId);
    expect(stock).toBe(98);
  });

  it("is idempotent: retrying the same clientTxnId does not double-decrement stock", async () => {
    const cart = buildCart(3);
    const { totals, lines } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: false });

    const input = {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines,
      totals,
      payments: [{ mode: "cash" as const, amountPaise: totals.netPaise, refNo: null }],
    };

    const first = await createSale(db, input);
    const second = await createSale(db, input);

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);

    const stock = await getStock(db, storeId, productId);
    expect(stock).toBe(97);
  });

  it("issues gap-free, increasing bill numbers per counter", async () => {
    const cart1 = buildCart(1);
    const cart2 = buildCart(1);

    const { totals: t1, lines: l1 } = computeCartTotals(cart1, {
      costPricePaiseByProduct: {},
      allowBelowCost: false,
    });
    const { totals: t2, lines: l2 } = computeCartTotals(cart2, {
      costPricePaiseByProduct: {},
      allowBelowCost: false,
    });

    const sale1 = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart1.clientTxnId,
      lines: l1,
      totals: t1,
      payments: [{ mode: "cash", amountPaise: t1.netPaise, refNo: null }],
    });
    const sale2 = await createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart2.clientTxnId,
      lines: l2,
      totals: t2,
      payments: [{ mode: "cash", amountPaise: t2.netPaise, refNo: null }],
    });

    const n1 = Number(sale1.sale.billNo.split("-").pop());
    const n2 = Number(sale2.sale.billNo.split("-").pop());
    expect(n2).toBe(n1 + 1);
  });
});
