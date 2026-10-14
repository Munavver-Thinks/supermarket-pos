import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // A pack size of a bulk product — "Sugar 1kg" as a child of "Sugar 50kg Bag". A child is a
  // fully ordinary, independently-stocked, independently-sellable product in every other
  // respect: its own inventory row, its own batches, its own barcode. Only two things make it
  // a child: this link back to the parent, and (optionally) a price that follows the parent's.
  //
  // One level only — a child's own parent_product_id is always null, enforced in the
  // application, not here: which batch's expiry and which price is the real source would
  // stop being unambiguous the moment packs could be made from packs.
  await db.schema.alterTable("products").addColumn("parent_product_id", "text", (c) => c.references("products.id")).execute();

  // How much of the parent's uom one unit of this child represents — e.g. 1 for a "1kg" child
  // of a kg-priced parent, 0.5 for "500g". Null for anything that isn't a child.
  await db.schema.alterTable("products").addColumn("pack_qty", "real").execute();

  // Whether this child's sale/cost/MRP follow the parent's price automatically. Starts true
  // for a newly created child; editing the child's own price directly turns it off — from
  // then on, changing the parent's price never touches this child again. Meaningless (and
  // left false) for anything that isn't a child.
  await db.schema
    .alterTable("products")
    .addColumn("price_linked_to_parent", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  // Every price change on a product looks up its children to cascade to.
  await db.schema.createIndex("idx_products_parent").on("products").columns(["parent_product_id"]).execute();
}
