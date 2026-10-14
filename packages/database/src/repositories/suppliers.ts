import { randomUUID } from "node:crypto";

import type { Supplier } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";

export interface SupplierInput {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
}

/**
 * Who is making the change. Every write from the app passes this so the entry lands in the
 * same transaction as the change; tests and fixtures that set up a supplier leave it out,
 * matching createProduct.
 */
export interface SupplierAuditContext {
  userId: string;
  deviceId: string | null;
}

const SUPPLIER_FIELDS = ["name", "phone", "email", "address", "gstin", "notes"] as const;

/** Only the fields that actually changed, so an entry says what was edited rather than repeating the whole record. */
export function diffSupplierFields(
  before: SupplierInput,
  after: SupplierInput,
): { oldValue: Partial<SupplierInput>; newValue: Partial<SupplierInput> } {
  const oldValue: Partial<SupplierInput> = {};
  const newValue: Partial<SupplierInput> = {};
  for (const key of SUPPLIER_FIELDS) {
    if (before[key] !== after[key]) {
      Object.assign(oldValue, { [key]: before[key] });
      Object.assign(newValue, { [key]: after[key] });
    }
  }
  return { oldValue, newValue };
}

/**
 * Runs in the caller's transaction when given one, so a caller that already opened a
 * transaction (Kysely can't nest them) still gets the write and its entry committed together.
 */
function inTransaction<T>(db: Db, work: (trx: Db) => Promise<T>): Promise<T> {
  return db.isTransaction ? work(db) : db.transaction().execute(work);
}

function pickFields(supplier: SupplierInput): SupplierInput {
  return {
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    gstin: supplier.gstin,
    notes: supplier.notes,
  };
}

export async function createSupplier(
  db: Db,
  storeId: string,
  input: SupplierInput,
  audit?: SupplierAuditContext,
): Promise<Supplier> {
  const id = randomUUID();
  return inTransaction(db, async (trx) => {
    await trx
      .insertInto("suppliers")
      .values({
        id,
        storeId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        notes: input.notes,
      })
      .execute();

    if (audit) {
      await appendAuditLog(trx, {
        storeId,
        userId: audit.userId,
        deviceId: audit.deviceId,
        action: "supplier_created",
        tableName: "suppliers",
        recordId: id,
        oldValue: null,
        newValue: pickFields(input),
        reason: null,
      });
    }

    return getSupplierOrThrow(trx, id);
  });
}

export async function updateSupplier(
  db: Db,
  supplierId: string,
  input: SupplierInput,
  audit?: SupplierAuditContext,
): Promise<Supplier> {
  return inTransaction(db, async (trx) => {
    // Read inside the transaction so the "before" values are the ones this write replaced.
    const before = await getSupplierOrThrow(trx, supplierId);

    await trx
      .updateTable("suppliers")
      .set({
        name: input.name,
        phone: input.phone,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        notes: input.notes,
      })
      .where("id", "=", supplierId)
      .execute();

    const { oldValue, newValue } = diffSupplierFields(before, input);
    // Saving the form unchanged is not an event worth a log line.
    if (audit && Object.keys(newValue).length > 0) {
      await appendAuditLog(trx, {
        storeId: before.storeId,
        userId: audit.userId,
        deviceId: audit.deviceId,
        action: "supplier_updated",
        tableName: "suppliers",
        recordId: supplierId,
        // The name is kept alongside the changes so the entry is readable even when the name itself didn't change.
        oldValue: { name: before.name, ...oldValue },
        newValue: { name: input.name, ...newValue },
        reason: null,
      });
    }

    return getSupplierOrThrow(trx, supplierId);
  });
}

/**
 * Suppliers are deactivated rather than deleted — purchases reference them permanently,
 * so removing the row would orphan the purchase history.
 */
export async function setSupplierActive(
  db: Db,
  supplierId: string,
  isActive: boolean,
  audit?: SupplierAuditContext,
): Promise<Supplier> {
  return inTransaction(db, async (trx) => {
    const before = await getSupplierOrThrow(trx, supplierId);

    await trx
      .updateTable("suppliers")
      .set({ isActive: isActive ? 1 : 0 })
      .where("id", "=", supplierId)
      .execute();

    // Re-sending the current state (a double click, a stale screen) changed nothing, so logs nothing.
    if (audit && before.isActive !== isActive) {
      await appendAuditLog(trx, {
        storeId: before.storeId,
        userId: audit.userId,
        deviceId: audit.deviceId,
        action: isActive ? "supplier_reactivated" : "supplier_deactivated",
        tableName: "suppliers",
        recordId: supplierId,
        oldValue: { name: before.name, isActive: before.isActive },
        newValue: { name: before.name, isActive },
        reason: null,
      });
    }

    return getSupplierOrThrow(trx, supplierId);
  });
}

export async function listSuppliers(db: Db, storeId: string, includeInactive = false): Promise<Supplier[]> {
  let query = db.selectFrom("suppliers").selectAll().where("storeId", "=", storeId);
  if (!includeInactive) {
    query = query.where("isActive", "=", 1);
  }
  const rows = await query.orderBy("name", "asc").execute();
  return rows.map(rowToSupplier);
}

export async function getSupplier(db: Db, supplierId: string): Promise<Supplier | undefined> {
  const row = await db.selectFrom("suppliers").selectAll().where("id", "=", supplierId).executeTakeFirst();
  return row ? rowToSupplier(row) : undefined;
}

async function getSupplierOrThrow(db: Db, supplierId: string): Promise<Supplier> {
  const row = await db.selectFrom("suppliers").selectAll().where("id", "=", supplierId).executeTakeFirstOrThrow();
  return rowToSupplier(row);
}

/** Products currently sourced from this supplier, for the supplier detail view. */
export async function listSupplierProducts(
  db: Db,
  supplierId: string,
): Promise<Array<{ productId: string; name: string; shortCode: string | null }>> {
  return db
    .selectFrom("products")
    .select(["id as productId", "name", "shortCode"])
    .where("supplierId", "=", supplierId)
    .where("isActive", "=", 1)
    .orderBy("name", "asc")
    .execute();
}

interface SupplierRow {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: number;
  createdAt: string;
}

function rowToSupplier(row: SupplierRow): Supplier {
  return { ...row, isActive: row.isActive === 1 };
}
