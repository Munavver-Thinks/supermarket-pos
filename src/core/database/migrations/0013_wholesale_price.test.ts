import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { createMigrator } from "../migrator.js";

/** 0013 adds one nullable column to an existing table — every existing price row must survive
 * untouched and read the new column as null, not zero (null means "not set", 0 means "free"). */
describe("0013 upgrade over existing data", () => {
  let db: Db;
  const ids = { org: randomUUID(), store: randomUUID(), product: randomUUID(), price: randomUUID() };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0012_product_packs");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Toor Dal 1kg', 'pcs', 0)
    `.execute(db);
    await sql`
      INSERT INTO product_prices (id, product_id, mrp_paise, sale_price_paise, cost_price_paise)
      VALUES (${ids.price}, ${ids.product}, 16000, 15000, 13000)
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps the existing price row and reads no wholesale rate as null, not zero", async () => {
    const price = await db.selectFrom("productPrices").selectAll().where("id", "=", ids.price).executeTakeFirst();
    expect(price).toMatchObject({ salePricePaise: 15000, wholesalePricePaise: null });
  });

  it("lets a new price row set a wholesale rate", async () => {
    const newPriceId = randomUUID();
    await db
      .insertInto("productPrices")
      .values({
        id: newPriceId,
        productId: ids.product,
        mrpPaise: 16000,
        salePricePaise: 15000,
        costPricePaise: 13000,
        wholesalePricePaise: 13500,
        effectiveFrom: new Date().toISOString(),
      })
      .execute();
    const price = await db.selectFrom("productPrices").selectAll().where("id", "=", newPriceId).executeTakeFirst();
    expect(price?.wholesalePricePaise).toBe(13500);
  });
});
