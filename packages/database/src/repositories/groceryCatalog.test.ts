import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { seedFirstRun } from "./seed.js";
import { seedGroceryCatalog } from "./groceryCatalog.js";
import { groceryCatalog, groceryCategories } from "./groceryCatalogData.js";

describe("seedGroceryCatalog", () => {
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

  it("inserts every catalog product with a unique short code, category, and price", async () => {
    const result = await seedGroceryCatalog(db, storeId);

    expect(result.productsCreated).toBe(groceryCatalog.length);
    expect(result.categoriesCreated).toBe(groceryCategories.length);

    const products = await db.selectFrom("products").selectAll().where("storeId", "=", storeId).execute();
    expect(products).toHaveLength(groceryCatalog.length);

    const shortCodes = new Set(products.map((p) => p.shortCode));
    expect(shortCodes.size).toBe(products.length);
    expect(products.every((p) => p.categoryId !== null)).toBe(true);

    const prices = await db.selectFrom("productPrices").selectAll().execute();
    expect(prices).toHaveLength(groceryCatalog.length);

    const inventoryRows = await db.selectFrom("inventory").selectAll().where("storeId", "=", storeId).execute();
    expect(inventoryRows).toHaveLength(groceryCatalog.length);
  });

  it("refuses to run twice against the same store", async () => {
    await seedGroceryCatalog(db, storeId);
    await expect(seedGroceryCatalog(db, storeId)).rejects.toThrow(/already has products/);
  });
});
