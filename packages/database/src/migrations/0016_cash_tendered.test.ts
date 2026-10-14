import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { createMigrator } from "../migrator.js";

/** 0016 adds two columns to an existing table — every existing payment row must survive
 * untouched and read tenderedPaise/changeAction as null (never a sentinel). */
describe("0016 upgrade over existing data", () => {
  let db: Db;
  const ids = {
    org: randomUUID(),
    store: randomUUID(),
    product: randomUUID(),
    user: randomUUID(),
    sale: randomUUID(),
    saleItem: randomUUID(),
    payment: randomUUID(),
  };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0015_exchange_returns");
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
      INSERT INTO payments (id, sale_id, mode, amount_paise, ref_no)
      VALUES (${ids.payment}, ${ids.sale}, 'cash', 10000, NULL)
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps the existing payment and reads its new columns as null", async () => {
    const row = await db.selectFrom("payments").selectAll().where("id", "=", ids.payment).executeTakeFirst();
    expect(row).toMatchObject({ amountPaise: 10000, tenderedPaise: null, changeAction: null });
  });
});
