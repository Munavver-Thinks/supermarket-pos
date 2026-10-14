import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Null means "recorded before batch-level MRP tracking existed" — the batch falls back to
  // the product's current MRP. 0 means "no printed MRP" (loose goods), matching the existing
  // product-level convention, and gives no price cap. Never confuse the two.
  await db.schema.alterTable("stock_batches").addColumn("mrp_paise", "integer").execute();
}
