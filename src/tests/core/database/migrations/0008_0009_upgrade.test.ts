import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { createMigrator } from "@/core/database/migrator.js";
import { getStock } from "@/core/database/repositories/inventory.js";
import { listForProduct } from "@/core/database/repositories/stockBatches.js";

/**
 * 0008 (stock_batches) and 0009 (purchase orders, plus two new columns on purchases) run
 * against shops that already have real data. They must be purely additive: every existing
 * row survives unchanged, the new purchase columns read as NULL, and a shop that upgraded
 * has no batches — its stock is simply untracked until new goods arrive with a date.
 */
describe("0008 / 0009 upgrade over existing data", () => {
  let db: Db;
  const ids = {
    org: randomUUID(),
    store: randomUUID(),
    user: randomUUID(),
    supplier: randomUUID(),
    product: randomUUID(),
    sale: randomUUID(),
    saleItem: randomUUID(),
    saleReturn: randomUUID(),
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
    await sql`INSERT INTO suppliers (id, store_id, name) VALUES (${ids.supplier}, ${ids.store}, 'Balaji')`.execute(db);
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent, supplier_id)
      VALUES (${ids.product}, ${ids.store}, 'Toor Dal', 'kg', 0, ${ids.supplier})
    `.execute(db);
    await sql`
      INSERT INTO inventory (product_id, store_id, qty_on_hand, reorder_level)
      VALUES (${ids.product}, ${ids.store}, 12, 3)
    `.execute(db);
    await sql`
      INSERT INTO purchases (id, store_id, supplier_id, invoice_no, invoice_date, subtotal_paise, tax_paise, total_paise, user_id)
      VALUES (${ids.purchase}, ${ids.store}, ${ids.supplier}, 'INV-OLD', '2026-08-01', 140000, 0, 140000, ${ids.user})
    `.execute(db);
    await sql`
      INSERT INTO sales (id, store_id, counter_id, bill_no, client_txn_id, user_id, gross_paise, discount_paise,
                         taxable_paise, cgst_paise, sgst_paise, round_off_paise, net_paise)
      VALUES (${ids.sale}, ${ids.store}, 'c1', 'POS/2026-27/000001', ${randomUUID()}, ${ids.user},
              33000, 0, 33000, 0, 0, 0, 33000)
    `.execute(db);
    await sql`
      INSERT INTO sale_items (id, sale_id, line_no, product_id, qty, unit_price_paise, discount_paise, taxable_paise,
                              tax_rate_percent, cgst_paise, sgst_paise, line_total_paise)
      VALUES (${ids.saleItem}, ${ids.sale}, 1, ${ids.product}, 2, 16500, 0, 33000, 0, 0, 0, 33000)
    `.execute(db);
    await sql`
      INSERT INTO sale_returns (id, store_id, counter_id, sale_id, return_no, client_txn_id, user_id, taxable_paise,
                                cgst_paise, sgst_paise, discount_paise, round_off_paise, refund_paise, refund_mode)
      VALUES (${ids.saleReturn}, ${ids.store}, 'c1', ${ids.sale}, 'RET/1', ${randomUUID()}, ${ids.user},
              16500, 0, 0, 0, 0, 16500, 'cash')
    `.execute(db);
    await sql`
      INSERT INTO stock_adjustments (id, store_id, product_id, qty_before, qty_after, reason, user_id)
      VALUES (${ids.adjustment}, ${ids.store}, ${ids.product}, 10, 12, 'adjustment_correction', ${ids.user})
    `.execute(db);

    const latest = await createMigrator(db).migrateToLatest();
    if (latest.error) throw latest.error;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("keeps every existing row and leaves the new purchase columns empty", async () => {
    const purchase = await db.selectFrom("purchases").selectAll().where("id", "=", ids.purchase).executeTakeFirst();
    expect(purchase).toMatchObject({
      invoiceNo: "INV-OLD",
      totalPaise: 140000,
      purchaseOrderId: null,
      clientTxnId: null,
    });

    expect(await db.selectFrom("sales").select(["id", "netPaise"]).execute()).toEqual([
      { id: ids.sale, netPaise: 33000 },
    ]);
    expect(await db.selectFrom("saleItems").select("id").execute()).toHaveLength(1);
    const saleReturn = await db.selectFrom("saleReturns").select(["id", "refundPaise"]).executeTakeFirst();
    expect(saleReturn).toEqual({ id: ids.saleReturn, refundPaise: 16500 });
    const adjustment = await db.selectFrom("stockAdjustments").selectAll().executeTakeFirst();
    expect(adjustment).toMatchObject({ id: ids.adjustment, qtyAfter: 12, approvedByUserId: null });
    expect(await getStock(db, ids.store, ids.product)).toBe(12);
  });

  it("starts with no batches and no purchase orders", async () => {
    expect(await listForProduct(db, ids.store, ids.product)).toEqual([]);
    expect(await db.selectFrom("purchaseOrders").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("purchaseOrderItems").selectAll().execute()).toEqual([]);
  });

  it("allows many old purchases without a retry key but refuses a repeated key", async () => {
    const insertPurchase = (clientTxnId: string | null, invoiceNo: string) =>
      db
        .insertInto("purchases")
        .values({
          id: randomUUID(),
          storeId: ids.store,
          supplierId: ids.supplier,
          invoiceNo,
          invoiceDate: "2026-09-01",
          notes: null,
          subtotalPaise: 0,
          taxPaise: 0,
          totalPaise: 0,
          userId: ids.user,
          clientTxnId,
        })
        .execute();

    await insertPurchase(null, "A");
    await insertPurchase(null, "B");
    const key = randomUUID();
    await insertPurchase(key, "C");
    await expect(insertPurchase(key, "D")).rejects.toThrow();
  });
});
