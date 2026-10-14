import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { createMigrator } from "@/core/database/migrator.js";

/**
 * 0012 (product packs) is purely additive on top of a shop's real product catalog: every
 * existing product survives unchanged, reads as "not a child" of anything, and starts
 * unlinked from any parent price (the flag defaults to the safe reading — nothing starts
 * silently following a price it was never set up to follow).
 */
describe("0012 upgrade over existing data", () => {
  let db: Db;
  const ids = { org: randomUUID(), store: randomUUID(), product: randomUUID() };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0009_purchase_orders");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Sugar 50kg Bag', 'kg', 0)
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps the existing product and reads it as not a child of anything", async () => {
    const product = await db.selectFrom("products").selectAll().where("id", "=", ids.product).executeTakeFirst();
    expect(product).toMatchObject({
      name: "Sugar 50kg Bag",
      parentProductId: null,
      packQty: null,
      priceLinkedToParent: 0,
    });
  });

  it("lets a new product be created as a child of the old one", async () => {
    const childId = randomUUID();
    await db
      .insertInto("products")
      .values({
        id: childId,
        storeId: ids.store,
        name: "Sugar 1kg",
        uom: "pcs",
        taxRatePercent: 0,
        parentProductId: ids.product,
        packQty: 1,
        priceLinkedToParent: 1,
      })
      .execute();

    const child = await db.selectFrom("products").selectAll().where("id", "=", childId).executeTakeFirst();
    expect(child).toMatchObject({ parentProductId: ids.product, packQty: 1, priceLinkedToParent: 1 });
  });
});
