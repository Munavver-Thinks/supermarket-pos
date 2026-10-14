import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("suppliers")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("phone", "text")
    .addColumn("email", "text")
    .addColumn("address", "text")
    .addColumn("gstin", "text")
    .addColumn("notes", "text")
    .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_suppliers_store").on("suppliers").columns(["store_id"]).execute();

  await db.schema.alterTable("products").addColumn("supplier_id", "text").execute();

  // Promote the free-text products.supplier_name (migration 0002) into real supplier rows,
  // one per distinct name per store, then point each product at its new supplier.
  //
  // The column names below are snake_case because raw SQL bypasses CamelCasePlugin on the
  // way *in* — but the plugin still rewrites the returned rows, so the results come back
  // camelCased. Hence snake_case in the query, camelCase when reading the rows.
  const existing = await sql<{ storeId: string; supplierName: string }>`
    SELECT DISTINCT store_id, supplier_name
    FROM products
    WHERE supplier_name IS NOT NULL AND trim(supplier_name) <> ''
  `.execute(db);

  for (const row of existing.rows) {
    const supplierId = randomUUID();
    await sql`
      INSERT INTO suppliers (id, store_id, name) VALUES (${supplierId}, ${row.storeId}, ${row.supplierName})
    `.execute(db);
    await sql`
      UPDATE products SET supplier_id = ${supplierId}
      WHERE store_id = ${row.storeId} AND supplier_name = ${row.supplierName}
    `.execute(db);
  }

  await db.schema.alterTable("products").dropColumn("supplier_name").execute();

  await db.schema
    .createTable("purchases")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("supplier_id", "text", (c) => c.notNull().references("suppliers.id"))
    .addColumn("invoice_no", "text")
    .addColumn("invoice_date", "text", (c) => c.notNull())
    .addColumn("notes", "text")
    .addColumn("subtotal_paise", "integer", (c) => c.notNull())
    .addColumn("tax_paise", "integer", (c) => c.notNull())
    .addColumn("total_paise", "integer", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema
    .createIndex("idx_purchases_store_created")
    .on("purchases")
    .columns(["store_id", "created_at"])
    .execute();

  await db.schema
    .createTable("purchase_items")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("purchase_id", "text", (c) => c.notNull().references("purchases.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty", "real", (c) => c.notNull())
    .addColumn("cost_price_paise", "integer", (c) => c.notNull())
    .addColumn("tax_rate_percent", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("taxable_paise", "integer", (c) => c.notNull())
    .addColumn("tax_paise", "integer", (c) => c.notNull())
    .addColumn("line_total_paise", "integer", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("idx_purchase_items_purchase").on("purchase_items").columns(["purchase_id"]).execute();
}
