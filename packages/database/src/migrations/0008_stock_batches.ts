import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // A breakdown of on-hand stock by what arrived together with the same expiry date, so the
  // shop can see what is about to go off and sell the oldest first. It is never a second
  // source of truth: inventory.qty_on_hand stays the count, and the sum of qty_remaining
  // here is kept at or below it. Stock that arrived without a batch (older purchases,
  // returns, counted-in stock) is simply untracked.
  await db.schema
    .createTable("stock_batches")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("batch_no", "text")
    // YYYY-MM-DD, the last day the goods may be sold. Null for a batch tracked only by number.
    .addColumn("expiry_date", "text")
    .addColumn("qty_received", "real", (c) => c.notNull())
    .addColumn("qty_remaining", "real", (c) => c.notNull())
    .addColumn("cost_price_paise", "integer", (c) => c.notNull())
    .addColumn("purchase_id", "text", (c) => c.references("purchases.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  // Every sale of a product walks its batches, so this is read on each bill line.
  await db.schema
    .createIndex("idx_stock_batches_store_product")
    .on("stock_batches")
    .columns(["store_id", "product_id"])
    .execute();

  // The expiring / expired lists and the dashboard counts filter by date across the store.
  await db.schema
    .createIndex("idx_stock_batches_store_expiry")
    .on("stock_batches")
    .columns(["store_id", "expiry_date"])
    .execute();
}
