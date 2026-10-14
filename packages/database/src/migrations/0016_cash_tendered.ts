import type { Kysely } from "kysely";

// Null on every pre-0016 row and on any payment that wasn't overpaid in cash; amount_paise is
// always the applied amount — see PaymentInput's doc comments in @pos/types for the full rule.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("payments").addColumn("tendered_paise", "integer").execute();
  await db.schema.alterTable("payments").addColumn("change_action", "text").execute();
}
