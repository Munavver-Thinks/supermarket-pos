import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Where the product lives in the shop, and how long a pack made in-store stays good — the
  // default best-before when repacking. Both optional, null on every existing product.
  await db.schema.alterTable("products").addColumn("rack_location", "text").execute();
  await db.schema.alterTable("products").addColumn("shelf_life_days", "integer").execute();

  // One row per repack, so a pack on the shelf can be traced to the bulk batch it came from,
  // who packed it and when. Created before stock_batches is altered so the FK target exists.
  await db.schema
    .createTable("repacks")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("parent_product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("child_product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("child_qty", "real", (c) => c.notNull())
    .addColumn("parent_qty_used", "real", (c) => c.notNull())
    .addColumn("batch_no", "text", (c) => c.notNull().unique())
    .addColumn("packed_on", "text", (c) => c.notNull())
    .addColumn("expiry_date", "text")
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_repacks_child").on("repacks").columns(["child_product_id", "created_at"]).execute();
  await db.schema.createIndex("idx_repacks_parent").on("repacks").columns(["parent_product_id", "created_at"]).execute();

  await db.schema.alterTable("stock_batches").addColumn("packed_on", "text").execute();
  await db.schema.alterTable("stock_batches").addColumn("repack_id", "text", (c) => c.references("repacks.id")).execute();

  // Which bulk batches (or untracked stock, parent_batch_id null) a repack drew from.
  await db.schema
    .createTable("repack_sources")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("repack_id", "text", (c) => c.notNull().references("repacks.id"))
    .addColumn("parent_batch_id", "text", (c) => c.references("stock_batches.id"))
    .addColumn("qty", "real", (c) => c.notNull())
    .addColumn("expiry_date", "text")
    .execute();
  await db.schema.createIndex("idx_repack_sources_repack").on("repack_sources").columns(["repack_id"]).execute();

  // Append-only record of shelf labels printed, written only after the printer reported success.
  await db.schema
    .createTable("label_prints")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("repack_id", "text", (c) => c.references("repacks.id"))
    .addColumn("label_count", "integer", (c) => c.notNull())
    .addColumn("barcode", "text", (c) => c.notNull())
    .addColumn("packed_on", "text")
    .addColumn("expiry_date", "text")
    .addColumn("mrp_paise", "integer", (c) => c.notNull())
    .addColumn("sale_price_paise", "integer", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema
    .createIndex("idx_label_prints_product")
    .on("label_prints")
    .columns(["product_id", "created_at"])
    .execute();
}
