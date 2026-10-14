import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { createCustomer, diffCustomerFields, getById, updateCustomer } from "./customers.js";
import { seedFirstRun } from "./seed.js";

describe("customer audit", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  const deviceId = "device-1";

  const base = { name: "Lakshmi", phone: "9840012345", address: "East Masi Street" };

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Test Org",
      storeName: "Test Store",
      deviceName: "Register 1",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    userId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function entries(action: string) {
    return listAuditLog(db, storeId, { limit: 100, action });
  }

  it("records a customer added through the app, with who and on which device", async () => {
    const customer = await createCustomer(db, { storeId, ...base }, { userId, deviceId });

    const [entry] = await entries("customer_created");
    expect(entry?.recordId).toBe(customer.id);
    expect(entry?.userName).toBe("Owner");
    expect(entry?.deviceId).toBe(deviceId);
    expect(entry?.oldValue).toBeNull();
    expect(entry?.newValue).toEqual(base);
  });

  it("writes no entry when no one is behind the change, as for fixtures", async () => {
    await createCustomer(db, { storeId, ...base });
    expect(await listAuditLog(db, storeId, { limit: 100 })).toHaveLength(0);
  });

  it("records only the fields an edit changed, plus the name for context", async () => {
    const customer = await createCustomer(db, { storeId, ...base }, { userId, deviceId });

    await updateCustomer(db, customer.id, { ...base, phone: "9940012345" }, { userId, deviceId });

    const [entry] = await entries("customer_updated");
    expect(entry?.recordId).toBe(customer.id);
    expect(entry?.oldValue).toEqual({ name: "Lakshmi", phone: "9840012345" });
    expect(entry?.newValue).toEqual({ name: "Lakshmi", phone: "9940012345" });
    expect(await getById(db, customer.id)).toMatchObject({ phone: "9940012345" });
  });

  it("records a rename with the old and new name", async () => {
    const customer = await createCustomer(db, { storeId, ...base }, { userId, deviceId });
    await updateCustomer(db, customer.id, { ...base, name: "Lakshmi R" }, { userId, deviceId });

    const [entry] = await entries("customer_updated");
    expect(entry?.oldValue).toEqual({ name: "Lakshmi" });
    expect(entry?.newValue).toEqual({ name: "Lakshmi R" });
  });

  it("logs nothing when the form is saved unchanged", async () => {
    const customer = await createCustomer(db, { storeId, ...base }, { userId, deviceId });
    await updateCustomer(db, customer.id, { ...base }, { userId, deviceId });
    expect(await entries("customer_updated")).toHaveLength(0);
  });

  it("joins a caller's transaction, so a rolled-back change takes its entry with it", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await createCustomer(trx, { storeId, ...base }, { userId, deviceId });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await entries("customer_created")).toHaveLength(0);
  });
});

describe("diffCustomerFields", () => {
  it("returns empty objects when nothing changed", () => {
    const fields = { name: "A", phone: null, address: null };
    expect(diffCustomerFields(fields, { ...fields })).toEqual({ oldValue: {}, newValue: {} });
  });

  it("treats clearing a field as a change", () => {
    const before = { name: "A", phone: "1", address: null };
    expect(diffCustomerFields(before, { ...before, phone: null })).toEqual({
      oldValue: { phone: "1" },
      newValue: { phone: null },
    });
  });
});
