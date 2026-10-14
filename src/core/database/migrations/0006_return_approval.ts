import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Who signed off a refund. A cashier's return needs a manager's approval; a manager's or
  // owner's return is recorded as approved by themselves. Nullable because every return
  // written before this release had no approval step — those rows stay as they were.
  await db.schema
    .alterTable("sale_returns")
    .addColumn("approved_by_user_id", "text", (c) => c.references("users.id"))
    .execute();
}
