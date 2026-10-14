import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Every print or PDF of a bill, append-only. The first print of a sale is the original;
  // any later one is a duplicate and is stamped "DUPLICATE COPY". Deciding that from this
  // table — rather than from a flag the screen sends — means a reprint can't be passed off
  // as an original.
  await db.schema
    .createTable("receipt_prints")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("sale_id", "text", (c) => c.notNull().references("sales.id"))
    // receipt (80 mm thermal), a4 (printed invoice) or pdf (saved invoice).
    .addColumn("format", "text", (c) => c.notNull())
    // Null when no signed-in user could be tied to the print.
    .addColumn("user_id", "text", (c) => c.references("users.id"))
    .addColumn("printed_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  // "Has this bill been printed before?" is asked on every print.
  await db.schema.createIndex("idx_receipt_prints_sale").on("receipt_prints").columns(["sale_id"]).execute();
}
