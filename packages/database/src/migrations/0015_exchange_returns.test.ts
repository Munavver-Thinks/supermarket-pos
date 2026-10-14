import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { createMigrator } from "../migrator.js";

/** 0015 adds two columns to an existing table — every existing return row must survive
 * untouched and read exchangePaise as 0 (never a sentinel null) and exchangeSaleId as null. */
describe("0015 upgrade over existing data", () => {
  let db: Db;
  const ids = {
    org: randomUUID(),
    store: randomUUID(),
    product: randomUUID(),
    user: randomUUID(),
    sale: randomUUID(),
    saleItem: randomUUID(),
    return_: randomUUID(),
  };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0014_batch_mrp");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO users (id, store_id, username, password_hash, display_name, role)
      VALUES (${ids.user}, ${ids.store}, 'cashier1', 'x', 'Cashier', 'cashier')
    `.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Toor Dal 1kg', 'pcs', 0)
    `.execute(db);
    await sql`
      INSERT INTO sales (id, store_id, counter_id, bill_no, client_txn_id, user_id, status, gross_paise,
        discount_paise, taxable_paise, cgst_paise, sgst_paise, round_off_paise, net_paise)
      VALUES (${ids.sale}, ${ids.store}, 'C1', 'POS-1', ${randomUUID()}, ${ids.user}, 'completed', 10000,
        0, 10000, 0, 0, 0, 10000)
    `.execute(db);
    await sql`
      INSERT INTO sale_items (id, sale_id, line_no, product_id, qty, unit_price_paise, discount_paise,
        taxable_paise, tax_rate_percent, cgst_paise, sgst_paise, line_total_paise)
      VALUES (${ids.saleItem}, ${ids.sale}, 1, ${ids.product}, 1, 10000, 0, 10000, 0, 0, 0, 10000)
    `.execute(db);
    await sql`
      INSERT INTO sale_returns (id, store_id, counter_id, sale_id, return_no, client_txn_id, user_id,
        taxable_paise, cgst_paise, sgst_paise, discount_paise, round_off_paise, refund_paise, refund_mode)
      VALUES (${ids.return_}, ${ids.store}, 'C1', ${ids.sale}, 'POS-RET-1', ${randomUUID()}, ${ids.user},
        10000, 0, 0, 0, 0, 10000, 'cash')
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps the existing return and reads its exchange fields as the standalone default", async () => {
    const row = await db.selectFrom("saleReturns").selectAll().where("id", "=", ids.return_).executeTakeFirst();
    expect(row).toMatchObject({ exchangePaise: 0, exchangeSaleId: null });
  });
});
