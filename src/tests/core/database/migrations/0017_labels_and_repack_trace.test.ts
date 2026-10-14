import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { createMigrator } from "@/core/database/migrator.js";

/** 0017 adds columns to existing tables and three new ones — old rows must read null. */
describe("0017 upgrade over existing data", () => {
  let db: Db;
  const ids = {
    org: randomUUID(),
    store: randomUUID(),
    product: randomUUID(),
    user: randomUUID(),
    batch: randomUUID(),
  };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0016_cash_tendered");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO users (id, store_id, username, password_hash, display_name, role)
      VALUES (${ids.user}, ${ids.store}, 'owner1', 'x', 'Owner', 'owner')
    `.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Sugar 1kg', 'pcs', 0)
    `.execute(db);
    await sql`
      INSERT INTO stock_batches (id, store_id, product_id, qty_received, qty_remaining, cost_price_paise)
      VALUES (${ids.batch}, ${ids.store}, ${ids.product}, 5, 5, 4000)
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("reads the new columns of existing rows as null", async () => {
    const product = await db.selectFrom("products").selectAll().where("id", "=", ids.product).executeTakeFirst();
    expect(product).toMatchObject({ rackLocation: null, shelfLifeDays: null });
    const batch = await db.selectFrom("stockBatches").selectAll().where("id", "=", ids.batch).executeTakeFirst();
    expect(batch).toMatchObject({ packedOn: null, repackId: null, qtyRemaining: 5 });
  });

  it("accepts rows in the new tables", async () => {
    const repackId = randomUUID();
    await db
      .insertInto("repacks")
      .values({
        id: repackId,
        storeId: ids.store,
        parentProductId: ids.product,
        childProductId: ids.product,
        childQty: 10,
        parentQtyUsed: 10,
        batchNo: "RP-20261007-1",
        packedOn: "2026-10-07",
        expiryDate: null,
        userId: ids.user,
      })
      .execute();
    await db
      .insertInto("repackSources")
      .values({ id: randomUUID(), repackId, parentBatchId: ids.batch, qty: 10, expiryDate: null })
      .execute();
    await db
      .insertInto("labelPrints")
      .values({
        id: randomUUID(),
        storeId: ids.store,
        productId: ids.product,
        repackId,
        labelCount: 10,
        barcode: "20000001",
        packedOn: "2026-10-07",
        expiryDate: null,
        mrpPaise: 3000,
        salePricePaise: 2400,
        userId: ids.user,
      })
      .execute();
    const rows = await db.selectFrom("labelPrints").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBeTruthy();
  });
});
