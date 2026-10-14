import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("organizations")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createTable("stores")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("organization_id", "text", (c) => c.notNull().references("organizations.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("address", "text")
    .addColumn("gstin", "text")
    .addColumn("state_code", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createTable("devices")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("activation_key", "text", (c) => c.notNull().unique())
    .addColumn("activated_at", "text")
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("username", "text", (c) => c.notNull())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("display_name", "text", (c) => c.notNull())
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addUniqueConstraint("users_store_username_unique", ["store_id", "username"])
    .execute();

  await db.schema
    .createTable("app_settings")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("value", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("categories")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("parent_id", "text")
    .execute();

  await db.schema
    .createTable("brands")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("products")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("name_tamil", "text")
    .addColumn("short_code", "text")
    .addColumn("category_id", "text")
    .addColumn("brand_id", "text")
    .addColumn("uom", "text", (c) => c.notNull())
    .addColumn("is_weighted", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("hsn_code", "text")
    .addColumn("tax_rate_percent", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_products_store").on("products").columns(["store_id"]).execute();

  await db.schema
    .createTable("product_barcodes")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("barcode", "text", (c) => c.notNull().unique())
    .addColumn("uom", "text", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("idx_barcodes_barcode").on("product_barcodes").columns(["barcode"]).execute();

  await db.schema
    .createTable("product_aliases")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("alias", "text", (c) => c.notNull())
    .addColumn("alias_normalized", "text", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_aliases_normalized")
    .on("product_aliases")
    .columns(["alias_normalized"])
    .execute();

  await db.schema
    .createTable("product_prices")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("mrp_paise", "integer", (c) => c.notNull())
    .addColumn("sale_price_paise", "integer", (c) => c.notNull())
    .addColumn("cost_price_paise", "integer", (c) => c.notNull())
    .addColumn("is_tax_inclusive", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("effective_from", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addColumn("effective_to", "text")
    .execute();
  await db.schema.createIndex("idx_prices_product").on("product_prices").columns(["product_id"]).execute();

  await db.schema
    .createTable("inventory")
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("qty_on_hand", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("reorder_level", "real", (c) => c.notNull().defaultTo(0))
    .addColumn("updated_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addPrimaryKeyConstraint("inventory_pk", ["product_id", "store_id"])
    .execute();

  await db.schema
    .createTable("stock_ledger")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty_change", "real", (c) => c.notNull())
    .addColumn("reason", "text", (c) => c.notNull())
    .addColumn("reference_type", "text", (c) => c.notNull())
    .addColumn("reference_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_ledger_product").on("stock_ledger").columns(["product_id"]).execute();

  await db.schema
    .createTable("stock_adjustments")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty_before", "real", (c) => c.notNull())
    .addColumn("qty_after", "real", (c) => c.notNull())
    .addColumn("reason", "text", (c) => c.notNull())
    .addColumn("note", "text")
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("approved_by_user_id", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createTable("customers")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("phone", "text")
    .addColumn("address", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_customers_phone").on("customers").columns(["phone"]).execute();

  await db.schema
    .createTable("bill_sequence")
    .addColumn("counter_id", "text", (c) => c.notNull())
    .addColumn("financial_year", "text", (c) => c.notNull())
    .addColumn("prefix", "text", (c) => c.notNull())
    .addColumn("last_number", "integer", (c) => c.notNull().defaultTo(0))
    .addPrimaryKeyConstraint("bill_sequence_pk", ["counter_id", "financial_year"])
    .execute();

  await db.schema
    .createTable("sales")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull().references("stores.id"))
    .addColumn("counter_id", "text", (c) => c.notNull())
    .addColumn("bill_no", "text", (c) => c.notNull())
    .addColumn("client_txn_id", "text", (c) => c.notNull().unique())
    .addColumn("user_id", "text", (c) => c.notNull().references("users.id"))
    .addColumn("customer_id", "text")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("completed"))
    .addColumn("gross_paise", "integer", (c) => c.notNull())
    .addColumn("discount_paise", "integer", (c) => c.notNull())
    .addColumn("taxable_paise", "integer", (c) => c.notNull())
    .addColumn("cgst_paise", "integer", (c) => c.notNull())
    .addColumn("sgst_paise", "integer", (c) => c.notNull())
    .addColumn("round_off_paise", "integer", (c) => c.notNull())
    .addColumn("net_paise", "integer", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_sales_store_created").on("sales").columns(["store_id", "created_at"]).execute();

  await db.schema
    .createTable("sale_items")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("sale_id", "text", (c) => c.notNull().references("sales.id"))
    .addColumn("line_no", "integer", (c) => c.notNull())
    .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
    .addColumn("qty", "real", (c) => c.notNull())
    .addColumn("unit_price_paise", "integer", (c) => c.notNull())
    .addColumn("discount_paise", "integer", (c) => c.notNull())
    .addColumn("taxable_paise", "integer", (c) => c.notNull())
    .addColumn("tax_rate_percent", "real", (c) => c.notNull())
    .addColumn("cgst_paise", "integer", (c) => c.notNull())
    .addColumn("sgst_paise", "integer", (c) => c.notNull())
    .addColumn("line_total_paise", "integer", (c) => c.notNull())
    .execute();
  await db.schema.createIndex("idx_sale_items_sale").on("sale_items").columns(["sale_id"]).execute();

  await db.schema
    .createTable("payments")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("sale_id", "text", (c) => c.notNull().references("sales.id"))
    .addColumn("mode", "text", (c) => c.notNull())
    .addColumn("amount_paise", "integer", (c) => c.notNull())
    .addColumn("ref_no", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createTable("draft_bills")
    .addColumn("client_txn_id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull())
    .addColumn("counter_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("device_id", "text", (c) => c.notNull())
    .addColumn("cart_json", "text", (c) => c.notNull())
    .addColumn("label", "text")
    .addColumn("updated_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();

  await db.schema
    .createTable("cash_sessions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull())
    .addColumn("counter_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("opening_cash_paise", "integer", (c) => c.notNull())
    .addColumn("closing_cash_paise", "integer")
    .addColumn("counted_cash_paise", "integer")
    .addColumn("variance_paise", "integer")
    .addColumn("opened_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .addColumn("closed_at", "text")
    .execute();

  await db.schema
    .createTable("audit_logs")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("store_id", "text", (c) => c.notNull())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("device_id", "text")
    .addColumn("action", "text", (c) => c.notNull())
    .addColumn("table_name", "text", (c) => c.notNull())
    .addColumn("record_id", "text", (c) => c.notNull())
    .addColumn("old_value", "text")
    .addColumn("new_value", "text")
    .addColumn("reason", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
  await db.schema.createIndex("idx_audit_store_created").on("audit_logs").columns(["store_id", "created_at"]).execute();

  await db.schema
    .createTable("error_logs")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("error_id", "text", (c) => c.notNull())
    .addColumn("store_id", "text")
    .addColumn("user_id", "text")
    .addColumn("message", "text", (c) => c.notNull())
    .addColumn("stack", "text")
    .addColumn("context", "text")
    .addColumn("created_at", "text", (c) => c.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const tables = [
    "error_logs",
    "audit_logs",
    "cash_sessions",
    "draft_bills",
    "payments",
    "sale_items",
    "sales",
    "bill_sequence",
    "customers",
    "stock_adjustments",
    "stock_ledger",
    "inventory",
    "product_prices",
    "product_aliases",
    "product_barcodes",
    "products",
    "brands",
    "categories",
    "app_settings",
    "users",
    "devices",
    "stores",
    "organizations",
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
