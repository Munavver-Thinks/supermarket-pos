import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { createMigrator } from "@/core/database/migrator.js";

/**
 * The 0003 migration promotes the free-text products.supplier_name written by 0002 into
 * real supplier rows and then drops the column — a one-way data move against whatever a
 * shop already typed, so it's exercised here against the schema as it stood at 0002.
 */
describe("0003_suppliers_and_purchases backfill", () => {
  let db: Db;
  let storeId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });

    const migrator = createMigrator(db);
    const { error } = await migrator.migrateTo("0002_product_supplier_name");
    if (error) throw error;

    const organizationId = randomUUID();
    storeId = randomUUID();
    await sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, 'Org')`.execute(db);
    await sql`
      INSERT INTO stores (id, organization_id, name) VALUES (${storeId}, ${organizationId}, 'Store')
    `.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function insertProduct(name: string, supplierName: string | null): Promise<string> {
    const id = randomUUID();
    await sql`
      INSERT INTO products (id, store_id, name, uom, tax_rate_percent, supplier_name)
      VALUES (${id}, ${storeId}, ${name}, 'pcs', 0, ${supplierName})
    `.execute(db);
    return id;
  }

  async function migrateToLatest(): Promise<void> {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  }

  it("creates one supplier per distinct name and links every product that used it", async () => {
    const rice = await insertProduct("Ponni Rice", "Sri Balaji Traders");
    const dal = await insertProduct("Toor Dal", "Sri Balaji Traders");
    const oil = await insertProduct("Sesame Oil", "Idhayam Distributors");

    await migrateToLatest();

    const suppliers = await db.selectFrom("suppliers").selectAll().where("storeId", "=", storeId).execute();
    expect(suppliers).toHaveLength(2);
    expect(suppliers.map((s) => s.name).sort()).toEqual(["Idhayam Distributors", "Sri Balaji Traders"]);

    const products = await db.selectFrom("products").select(["id", "supplierId"]).execute();
    const byId = new Map(products.map((p) => [p.id, p.supplierId]));
    const balajiId = suppliers.find((s) => s.name === "Sri Balaji Traders")?.id;

    expect(byId.get(rice)).toBe(balajiId);
    expect(byId.get(dal)).toBe(balajiId);
    expect(byId.get(oil)).toBe(suppliers.find((s) => s.name === "Idhayam Distributors")?.id);
  });

  it("leaves products with no supplier name unlinked rather than inventing a supplier", async () => {
    const noSupplier = await insertProduct("Salt", null);
    const blankSupplier = await insertProduct("Sugar", "   ");

    await migrateToLatest();

    expect(await db.selectFrom("suppliers").selectAll().execute()).toHaveLength(0);

    const products = await db.selectFrom("products").select(["id", "supplierId"]).execute();
    const byId = new Map(products.map((p) => [p.id, p.supplierId]));
    expect(byId.get(noSupplier)).toBeNull();
    expect(byId.get(blankSupplier)).toBeNull();
  });

  it("drops the old free-text column so the directory is the only source of truth", async () => {
    await insertProduct("Ponni Rice", "Sri Balaji Traders");

    await migrateToLatest();

    const columns = await sql<{ name: string }>`SELECT name FROM pragma_table_info('products')`.execute(db);
    const names = columns.rows.map((c) => c.name);
    expect(names).toContain("supplier_id");
    expect(names).not.toContain("supplier_name");
  });
});
