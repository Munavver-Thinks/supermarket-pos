import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // A return is its own transaction linked to the bill it reverses, never an edit of that
  // bill. The original sale stays exactly as it was printed, which is the whole point — a
  // bill that can be altered after the fact is not a record of anything.
  await db.schema
    .createTable("sale_returns")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("counter_id", "text", (c) => c.notNull())
    .addColumn("sale_id", "text", (c) => c.notNull().references("sales.id"))
    .addColumn("return_no", "text", (c) => c.notNull())
    // Same idempotency guard as sales: a retried click must not refund twice.
    .addColumn("client_txn_id", "text", (c) => c.notNull().unique())
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("reason", "text")
    .addColumn("taxable_paise", "integer", (c) => c.notNull())
    .addColumn("cgst_paise", "integer", (c) => c.notNull())
    .addColumn("sgst_paise", "integer", (c) => c.notNull())
    .addColumn("discount_paise", "integer", (c) => c.notNull())
    .addColumn("round_off_paise", "integer", (c) => c.notNull())
    .addColumn("refund_paise", "integer", (c) => c.notNull())
    // How the money went back: cash/upi/card, or credit to reduce the customer's khata.
    .addColumn("refund_mode", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema.createIndex("idx_sale_returns_sale").on("sale_returns").columns(["sale_id"]).execute();
  await db.schema
    .createIndex("idx_sale_returns_store_created")
    .on("sale_returns")
    .columns(["store_id", "created_at"])
    .execute();

  await db.schema
    .createTable("sale_return_items")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("return_id", "text", (c) => c.notNull().references("sale_returns.id"))
    .addColumn("sale_item_id", "text", (c) => c.notNull().references("sale_items.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty", "real", (c) => c.notNull())
    .addColumn("discount_paise", "integer", (c) => c.notNull())
    .addColumn("taxable_paise", "integer", (c) => c.notNull())
    .addColumn("cgst_paise", "integer", (c) => c.notNull())
    .addColumn("sgst_paise", "integer", (c) => c.notNull())
    .addColumn("line_total_paise", "integer", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("idx_sale_return_items_return")
    .on("sale_return_items")
    .columns(["return_id"])
    .execute();

  // How much of each sold line has already come back — the query that decides what is still
  // returnable runs on this for every bill lookup.
  await db.schema
    .createIndex("idx_sale_return_items_sale_item")
    .on("sale_return_items")
    .columns(["sale_item_id"])
    .execute();
}
