import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Null means "no wholesale rate set" — not zero, which would mean "free". A product with no
  // wholesale rate simply sells at the normal sale price even on a bill marked wholesale; see
  // cartStore.ts's addProduct, which is the one place that picks between the two.
  await db.schema.alterTable("product_prices").addColumn("wholesale_price_paise", "integer").execute();
}
