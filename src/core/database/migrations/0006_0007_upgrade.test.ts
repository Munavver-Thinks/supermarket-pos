import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { createMigrator } from "../migrator.js";

/**
 * A shop upgrading to this release already has bills, returns, purchases and stock
 * corrections. 0006 and 0007 must only add to that — so the rows are written against the
 * schema as it stood at 0005, and checked untouched after migrating to the latest.
 */
describe("0006_return_approval + 0007_receipt_prints upgrade", () => {
  let db: Db;
  const ids = {
    org: randomUUID(),
    store: randomUUID(),
    user: randomUUID(),
    product: randomUUID(),
    sale: randomUUID(),
    saleItem: randomUUID(),
    saleReturn: randomUUID(),
    supplier: randomUUID(),
    purchase: randomUUID(),
    adjustment: randomUUID(),
  };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    const { error } = await createMigrator(db).migrateTo("0005_returns");
    if (error) throw error;

    await sql`INSERT INTO organizations (id, name) VALUES (${ids.org}, 'Org')`.execute(db);
    await sql`INSERT INTO stores (id, organization_id, name) VALUES (${ids.store}, ${ids.org}, 'Store')`.execute(db);
    await sql`
      INSERT INTO users (id, store_id, username, password_hash, display_name, role)
      VALUES (${ids.user}, ${ids.store}, 'owner', 'hash', 'Owner', 'owner')
    `.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent)
      VALUES (${ids.product}, ${ids.store}, 'Toor Dal', 'pcs', 0)
    `.execute(db);
    await sql`
      INSERT INTO sales (id, store_id, counter_id, bill_no, client_txn_id, user_id, gross_paise,
        discount_paise, taxable_paise, cgst_paise, sgst_paise, round_off_paise, net_paise)
      VALUES (${ids.sale}, ${ids.store}, 'counter-1', 'POS/2026-27/000001', ${randomUUID()}, ${ids.user},
        30000, 0, 30000, 0, 0, 0, 30000)
    `.execute(db);
    await sql`
      INSERT INTO sale_items (id, sale_id, line_no, product_id, qty, unit_price_paise, discount_paise,
        taxable_paise, tax_rate_percent, cgst_paise, sgst_paise, line_total_paise)
      VALUES (${ids.saleItem}, ${ids.sale}, 1, ${ids.product}, 2, 15000, 0, 30000, 0, 0, 0, 30000)
    `.execute(db);
    await sql`
      INSERT INTO sale_returns (id, store_id, counter_id, sale_id, return_no, client_txn_id, user_id, reason,
        taxable_paise, cgst_paise, sgst_paise, discount_paise, round_off_paise, refund_paise, refund_mode)
      VALUES (${ids.saleReturn}, ${ids.store}, 'counter-1', ${ids.sale}, 'RET/2026-27/000001', ${randomUUID()},
        ${ids.user}, 'Damaged', 15000, 0, 0, 0, 0, 15000, 'cash')
    `.execute(db);
    await sql`
      INSERT INTO suppliers (id, store_id, name) VALUES (${ids.supplier}, ${ids.store}, 'Traders')
    `.execute(db);
    await sql`
      INSERT INTO purchases (id, store_id, supplier_id, invoice_no, invoice_date, subtotal_paise, tax_paise,
        total_paise, user_id)
      VALUES (${ids.purchase}, ${ids.store}, ${ids.supplier}, 'INV-9', '2026-09-01', 70000, 0, 70000, ${ids.user})
    `.execute(db);
    await sql`
      INSERT INTO stock_adjustments (id, store_id, product_id, qty_before, qty_after, reason, user_id)
      VALUES (${ids.adjustment}, ${ids.store}, ${ids.product}, 10, 8, 'adjustment_damaged', ${ids.user})
    `.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function migrateToLatest(): Promise<void> {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  }

  it("keeps an existing return intact with no approver recorded", async () => {
    await migrateToLatest();
    const ret = await db.selectFrom("saleReturns").selectAll().where("id", "=", ids.saleReturn).executeTakeFirstOrThrow();
    expect(ret).toMatchObject({
      saleId: ids.sale,
      returnNo: "RET/2026-27/000001",
      refundPaise: 15000,
      refundMode: "cash",
      reason: "Damaged",
      approvedByUserId: null,
    });
  });

  it("keeps sales, purchases and stock corrections as they were", async () => {
    await migrateToLatest();
    const sale = await db.selectFrom("sales").selectAll().where("id", "=", ids.sale).executeTakeFirstOrThrow();
    expect(sale).toMatchObject({ billNo: "POS/2026-27/000001", netPaise: 30000, status: "completed" });
    expect(await db.selectFrom("saleItems").selectAll().execute()).toHaveLength(1);

    const purchase = await db.selectFrom("purchases").selectAll().where("id", "=", ids.purchase).executeTakeFirstOrThrow();
    expect(purchase).toMatchObject({ invoiceNo: "INV-9", totalPaise: 70000 });

    const adjustment = await db
      .selectFrom("stockAdjustments")
      .selectAll()
      .where("id", "=", ids.adjustment)
      .executeTakeFirstOrThrow();
    expect(adjustment).toMatchObject({ qtyBefore: 10, qtyAfter: 8, approvedByUserId: null });
  });

  it("adds an empty receipt_prints table that treats old bills as never printed", async () => {
    await migrateToLatest();
    expect(await db.selectFrom("receiptPrints").selectAll().execute()).toHaveLength(0);

    await db
      .insertInto("receiptPrints")
      .values({ id: randomUUID(), storeId: ids.store, saleId: ids.sale, format: "receipt", userId: null })
      .execute();
    const [row] = await db.selectFrom("receiptPrints").selectAll().execute();
    expect(row?.printedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const indexes = await sql<{ name: string }>`SELECT name FROM pragma_index_list('receipt_prints')`.execute(db);
    expect(indexes.rows.map((r) => r.name)).toContain("idx_receipt_prints_sale");
  });

  it("lets a new return record its approver", async () => {
    await migrateToLatest();
    await db
      .updateTable("saleReturns")
      .set({ approvedByUserId: ids.user })
      .where("id", "=", ids.saleReturn)
      .execute();
    const ret = await db
      .selectFrom("saleReturns")
      .select("approvedByUserId")
      .where("id", "=", ids.saleReturn)
      .executeTakeFirstOrThrow();
    expect(ret.approvedByUserId).toBe(ids.user);
  });
});
