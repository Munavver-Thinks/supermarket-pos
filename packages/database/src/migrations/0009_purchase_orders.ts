import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // What the shop asked a supplier for, before anything arrives. Stock only moves when goods
  // are received against it, and each receipt is an ordinary purchase row linked back here —
  // so the stock, cost and audit rules for goods-in stay in one place.
  await db.schema
    .createTable("purchase_orders")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("supplier_id", "text", (c) => c.notNull().references("suppliers.id"))
    .addColumn("po_no", "text", (c) => c.notNull())
    // draft | ordered | partially_received | received | cancelled | closed
    .addColumn("status", "text", (c) => c.notNull().defaultTo("draft"))
    .addColumn("expected_date", "text")
    .addColumn("notes", "text")
    .addColumn("total_paise", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_by", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addColumn("updated_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addColumn("ordered_at", "text")
    .addColumn("closed_at", "text")
    .execute();

  // PO numbers come from the same gap-free sequence as bills, so a repeat means a bug.
  await db.schema
    .createIndex("idx_purchase_orders_store_po_no")
    .unique()
    .on("purchase_orders")
    .columns(["store_id", "po_no"])
    .execute();

  // The purchase-order list filters by status and shows newest first.
  await db.schema
    .createIndex("idx_purchase_orders_store_status_created")
    .on("purchase_orders")
    .columns(["store_id", "status", "created_at"])
    .execute();

  await db.schema
    .createTable("purchase_order_items")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("purchase_order_id", "text", (c) => c.notNull().references("purchase_orders.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty_ordered", "real", (c) => c.notNull())
    .addColumn("qty_received", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("cost_price_paise", "integer", (c) => c.notNull())
    .addColumn("tax_rate_percent", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("is_tax_inclusive", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("idx_purchase_order_items_po")
    .on("purchase_order_items")
    .columns(["purchase_order_id"])
    .execute();

  // Additive columns on an existing table: both are NULL for every purchase recorded before
  // this version, which is what "a direct receipt with no retry key" means.
  await db.schema
    .alterTable("purchases")
    .addColumn("purchase_order_id", "text", (c) => c.references("purchase_orders.id"))
    .execute();
  await db.schema.alterTable("purchases").addColumn("client_txn_id", "text").execute();

  // ADD COLUMN cannot carry UNIQUE in SQLite, so the retry guard is a separate index.
  // NULLs don't collide, so old rows without a key are fine.
  await db.schema
    .createIndex("idx_purchases_client_txn_id")
    .unique()
    .on("purchases")
    .columns(["client_txn_id"])
    .execute();

  await db.schema
    .createIndex("idx_purchases_purchase_order")
    .on("purchases")
    .columns(["purchase_order_id"])
    .execute();
}
