import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";
import { seedKiranaCatalog } from "@/core/database/repositories/kiranaCatalog.js";
import { kiranaCatalog, kiranaCategories } from "@/core/database/repositories/kiranaCatalogData.js";

describe("seedKiranaCatalog", () => {
  let db: Db;
  let storeId: string;
  let userId: string;

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

  it("inserts every catalog product with a unique short code, category, price, and opening stock", async () => {
    const result = await seedKiranaCatalog(db, storeId, userId);

    expect(result.productsCreated).toBe(kiranaCatalog.length);
    expect(result.categoriesCreated).toBe(kiranaCategories.length);

    const products = await db.selectFrom("products").selectAll().where("storeId", "=", storeId).execute();
    expect(products).toHaveLength(kiranaCatalog.length);

    const shortCodes = new Set(products.map((p) => p.shortCode));
    expect(shortCodes.size).toBe(products.length);
    expect(products.every((p) => p.categoryId !== null)).toBe(true);
    expect(products.every((p) => p.nameTamil !== null)).toBe(true);

    const prices = await db.selectFrom("productPrices").selectAll().execute();
    expect(prices).toHaveLength(kiranaCatalog.length);

    const inventoryRows = await db.selectFrom("inventory").selectAll().where("storeId", "=", storeId).execute();
    expect(inventoryRows).toHaveLength(kiranaCatalog.length);

    const totalStock = inventoryRows.reduce((sum, row) => sum + row.qtyOnHand, 0);
    const expectedStock = kiranaCatalog.reduce((sum, item) => sum + item.stockQty, 0);
    expect(totalStock).toBe(expectedStock);

    const ledgerRows = await db.selectFrom("stockLedger").selectAll().where("storeId", "=", storeId).execute();
    expect(ledgerRows).toHaveLength(kiranaCatalog.length);
    expect(ledgerRows.every((row) => row.reason === "manual_stock_in")).toBe(true);

    const aliases = await db.selectFrom("productAliases").selectAll().execute();
    expect(aliases).toHaveLength(kiranaCatalog.length);
  });

  it("refuses to run twice against the same store", async () => {
    await seedKiranaCatalog(db, storeId, userId);
    await expect(seedKiranaCatalog(db, storeId, userId)).rejects.toThrow(/already has products/);
  });
});
