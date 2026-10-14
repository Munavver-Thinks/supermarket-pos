import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // An exchange's return leg links forward to the new sale it was set off against. Nullable:
  // a standalone refund (today's Returns screen) never sets this. exchangePaise defaults to 0
  // for the same reason — only the exchange path ever writes a non-zero value.
  await db.schema.alterTable("sale_returns").addColumn("exchange_sale_id", "text", (c) => c.references("sales.id")).execute();
  await db.schema
    .alterTable("sale_returns")
    .addColumn("exchange_paise", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("idx_sale_returns_exchange_sale")
    .on("sale_returns")
    .columns(["exchange_sale_id"])
    .execute();
}
