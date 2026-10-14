import { randomUUID } from "node:crypto";

import type { Customer } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";

export interface CustomerInput {
  name: string;
  phone: string | null;
  address: string | null;
}

/**
 * Who is making the change. Every write from the app passes this so the entry lands in the
 * same transaction as the change; tests and fixtures that set up a customer leave it out,
 * matching createSupplier/createProduct.
 */
export interface CustomerAuditContext {
  userId: string;
  deviceId: string | null;
}

const CUSTOMER_FIELDS = ["name", "phone", "address"] as const;

/** Only the fields that actually changed, so an entry says what was edited rather than repeating the whole record. */
export function diffCustomerFields(
  before: CustomerInput,
  after: CustomerInput,
): { oldValue: Partial<CustomerInput>; newValue: Partial<CustomerInput> } {
  const oldValue: Partial<CustomerInput> = {};
  const newValue: Partial<CustomerInput> = {};
  for (const key of CUSTOMER_FIELDS) {
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

async function getCustomerOrThrow(db: Db, customerId: string): Promise<Customer> {
  const row = await db.selectFrom("customers").selectAll().where("id", "=", customerId).executeTakeFirst();
  if (!row) throw new Error(`Customer ${customerId} not found`);
  return row;
}

export async function createCustomer(
  db: Db,
  input: CustomerInput & { storeId: string },
  audit?: CustomerAuditContext,
): Promise<Customer> {
  const id = randomUUID();
  const { storeId, ...fields } = input;
  return inTransaction(db, async (trx) => {
    await trx
      .insertInto("customers")
      .values({ id, storeId, name: fields.name, phone: fields.phone, address: fields.address })
      .execute();

    if (audit) {
      await appendAuditLog(trx, {
        storeId,
        userId: audit.userId,
        deviceId: audit.deviceId,
        action: "customer_created",
        tableName: "customers",
        recordId: id,
        oldValue: null,
        newValue: { name: fields.name, phone: fields.phone, address: fields.address },
        reason: null,
      });
    }

    return getCustomerOrThrow(trx, id);
  });
}

export async function updateCustomer(
  db: Db,
  customerId: string,
  input: CustomerInput,
  audit?: CustomerAuditContext,
): Promise<Customer> {
  return inTransaction(db, async (trx) => {
    // Read inside the transaction so the "before" values are the ones this write replaced.
    const before = await getCustomerOrThrow(trx, customerId);

    await trx
      .updateTable("customers")
      .set({ name: input.name, phone: input.phone, address: input.address })
      .where("id", "=", customerId)
      .execute();

    const { oldValue, newValue } = diffCustomerFields(before, input);
    // Saving the form unchanged is not an event worth a log line.
    if (audit && Object.keys(newValue).length > 0) {
      await appendAuditLog(trx, {
        storeId: before.storeId,
        userId: audit.userId,
        deviceId: audit.deviceId,
        action: "customer_updated",
        tableName: "customers",
        recordId: customerId,
        // The name is kept alongside the changes so the entry is readable even when the name itself didn't change.
        oldValue: { name: before.name, ...oldValue },
        newValue: { name: input.name, ...newValue },
        reason: null,
      });
    }

    return getCustomerOrThrow(trx, customerId);
  });
}

export async function getById(db: Db, customerId: string): Promise<Customer | undefined> {
  return db.selectFrom("customers").selectAll().where("id", "=", customerId).executeTakeFirst();
}

export async function findCustomerByPhone(db: Db, storeId: string, phone: string): Promise<Customer | undefined> {
  return db
    .selectFrom("customers")
    .selectAll()
    .where("storeId", "=", storeId)
    .where("phone", "=", phone)
    .executeTakeFirst();
}

/** Most recently added customers, for the Customers screen when no search query is entered. */
export async function listRecent(db: Db, storeId: string, limit: number): Promise<Customer[]> {
  return db
    .selectFrom("customers")
    .selectAll()
    .where("storeId", "=", storeId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .execute();
}

export async function searchCustomers(db: Db, storeId: string, query: string): Promise<Customer[]> {
  const pattern = `%${query}%`;
  return db
    .selectFrom("customers")
    .selectAll()
    .where("storeId", "=", storeId)
    .where((eb) => eb.or([eb("name", "like", pattern), eb("phone", "like", pattern)]))
    .limit(20)
    .execute();
}
