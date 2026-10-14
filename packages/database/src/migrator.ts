import type { Kysely, Migration, MigrationProvider } from "kysely";
import { Migrator } from "kysely";

import * as m0001 from "./migrations/0001_init.js";
import * as m0002 from "./migrations/0002_product_supplier_name.js";
import * as m0003 from "./migrations/0003_suppliers_and_purchases.js";
import * as m0004 from "./migrations/0004_customer_credit.js";
import * as m0005 from "./migrations/0005_returns.js";
import * as m0006 from "./migrations/0006_return_approval.js";
import * as m0007 from "./migrations/0007_receipt_prints.js";
import * as m0008 from "./migrations/0008_stock_batches.js";
import * as m0009 from "./migrations/0009_purchase_orders.js";
import * as m0012 from "./migrations/0012_product_packs.js";
import * as m0013 from "./migrations/0013_wholesale_price.js";
import * as m0014 from "./migrations/0014_batch_mrp.js";
import * as m0015 from "./migrations/0015_exchange_returns.js";
import * as m0016 from "./migrations/0016_cash_tendered.js";
import * as m0017 from "./migrations/0017_labels_and_repack_trace.js";

const migrations: Record<string, Migration> = {
  "0001_init": m0001,
  "0002_product_supplier_name": m0002,
  "0003_suppliers_and_purchases": m0003,
  "0004_customer_credit": m0004,
  "0005_returns": m0005,
  "0006_return_approval": m0006,
  "0007_receipt_prints": m0007,
  "0008_stock_batches": m0008,
  "0009_purchase_orders": m0009,
  // 0010 and 0011 were reserved for batch / purchase-order follow-ups and not used; they are
  // retired — never add a migration numbered below the latest one already shipped.
  "0012_product_packs": m0012,
  "0013_wholesale_price": m0013,
  "0014_batch_mrp": m0014,
  "0015_exchange_returns": m0015,
  "0016_cash_tendered": m0016,
  "0017_labels_and_repack_trace": m0017,
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}

/**
 * Exposed so tests can step the schema to one specific migration, insert representative
 * rows, and then run the next one — the only way to exercise a data backfill against data
 * that only exists on the old schema.
 */
// Kysely's own Migration/MigrationProvider types are declared against `Kysely<any>`
// (a migration runs against an evolving schema, so it can't be pinned to one version).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({ db, provider: new StaticMigrationProvider() });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runMigrations(db: Kysely<any>): Promise<void> {
  const migrator = createMigrator(db);
  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === "Error") {
      throw new Error(`Migration "${result.migrationName}" failed`);
    }
  }
  if (error) {
    throw error;
  }
}
