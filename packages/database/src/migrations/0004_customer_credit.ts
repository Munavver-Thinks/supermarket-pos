import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Zero means "no limit set" rather than "no credit allowed" — every existing customer
  // predates this column, and silently refusing them all credit would be a worse default
  // than the shopkeeper's own judgement. A limit has to be entered to start binding.
  await db.schema
    .alterTable("customers")
    .addColumn("credit_limit_paise", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  // The khata. Append-only like stock_ledger: a balance is the sum of its entries, never a
  // number someone edits. Sign convention is the customer's side of the book — positive
  // means they owe the shop more, negative means they have paid it down.
  await db.schema
    .createTable("customer_ledger_entries")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("customer_id", "text", (c) => c.notNull().references("customers.id"))
    .addColumn("entry_type", "text", (c) => c.notNull())
    .addColumn("amount_paise", "integer", (c) => c.notNull())
    // Set for a credit_sale, so an entry can always be traced back to the bill it came from.
    .addColumn("sale_id", "text", (c) => c.references("sales.id"))
    // How a repayment arrived (cash/upi/card). Null for entries that aren't repayments.
    .addColumn("payment_mode", "text")
    .addColumn("note", "text")
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createIndex("idx_customer_ledger_customer")
    .on("customer_ledger_entries")
    .columns(["customer_id", "created_at"])
    .execute();

  await db.schema
    .createIndex("idx_customer_ledger_store")
    .on("customer_ledger_entries")
    .columns(["store_id"])
    .execute();

  // One credit sale writes exactly one ledger entry. createSale is idempotent on
  // client_txn_id, but a retry that reached the DB twice would otherwise be able to double
  // the customer's debt — this makes that impossible at the storage layer.
  await db.schema
    .createIndex("idx_customer_ledger_sale_unique")
    .on("customer_ledger_entries")
    .columns(["sale_id"])
    .unique()
    .where(sql.ref("sale_id"), "is not", null)
    .execute();
}
