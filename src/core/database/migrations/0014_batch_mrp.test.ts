import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { createMigrator } from "../migrator.js";

/** 0014 adds one nullable column to an existing table — every existing batch row must survive
 * untouched and read the new column as null, not zero (null falls back to the product's
 * current MRP; 0 means "no printed MRP"). */
describe("0014 upgrade over existing data", () => {
  let db: Db;
  const ids = { org: randomUUID(), store: randomUUID(), product: randomUUID(), batch: randomUUID() };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0013_wholesale_price");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Toor Dal 1kg', 'pcs', 0)
    `.execute(db);
    await sql`
      INSERT INTO stock_batches (id, store_id, product_id, qty_received, qty_remaining, cost_price_paise)
      VALUES (${ids.batch}, ${ids.store}, ${ids.product}, 10, 10, 13000)
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps the existing batch and reads its MRP as null, not zero", async () => {
    const batch = await db.selectFrom("stockBatches").selectAll().where("id", "=", ids.batch).executeTakeFirst();
    expect(batch).toMatchObject({ qtyRemaining: 10, mrpPaise: null });
  });

  it("lets a new batch set an MRP", async () => {
    const newBatchId = randomUUID();
    await db
      .insertInto("stockBatches")
      .values({
        id: newBatchId,
        storeId: ids.store,
        productId: ids.product,
        batchNo: null,
        expiryDate: null,
        qtyReceived: 5,
        qtyRemaining: 5,
        costPricePaise: 14000,
        mrpPaise: 16000,
        purchaseId: null,
      })
      .execute();
    const batch = await db.selectFrom("stockBatches").selectAll().where("id", "=", newBatchId).executeTakeFirst();
    expect(batch?.mrpPaise).toBe(16000);
  });
});
