import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { seedFirstRun } from "./seed.js";
import { createSupplier, diffSupplierFields, listSuppliers, setSupplierActive, updateSupplier } from "./suppliers.js";

describe("supplier audit", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  const deviceId = "device-1";

  const base = {
    name: "Madurai Traders",
    phone: "9840012345",
    email: null,
    address: "East Masi Street",
    gstin: null,
    notes: null,
  };

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

  it("records a supplier added through the app, with who and on which device", async () => {
    const supplier = await createSupplier(db, storeId, base, { userId, deviceId });

    const [entry] = await entries("supplier_created");
    expect(entry?.recordId).toBe(supplier.id);
    expect(entry?.userName).toBe("Owner");
    expect(entry?.deviceId).toBe(deviceId);
    expect(entry?.oldValue).toBeNull();
    expect(entry?.newValue).toEqual(base);
  });

  it("writes no entry when no one is behind the change, as for fixtures", async () => {
    await createSupplier(db, storeId, base);
    expect(await listAuditLog(db, storeId, { limit: 100 })).toHaveLength(0);
  });

  it("records only the fields an edit changed, plus the name for context", async () => {
    const supplier = await createSupplier(db, storeId, base, { userId, deviceId });

    await updateSupplier(db, supplier.id, { ...base, phone: "9940012345", gstin: "33AAAAA0000A1Z5" }, { userId, deviceId });

    const [entry] = await entries("supplier_updated");
    expect(entry?.recordId).toBe(supplier.id);
    expect(entry?.oldValue).toEqual({ name: "Madurai Traders", phone: "9840012345", gstin: null });
    expect(entry?.newValue).toEqual({ name: "Madurai Traders", phone: "9940012345", gstin: "33AAAAA0000A1Z5" });
  });

  it("records a rename with the old and new name", async () => {
    const supplier = await createSupplier(db, storeId, base, { userId, deviceId });
    await updateSupplier(db, supplier.id, { ...base, name: "Madurai Traders & Co" }, { userId, deviceId });

    const [entry] = await entries("supplier_updated");
    expect(entry?.oldValue).toEqual({ name: "Madurai Traders" });
    expect(entry?.newValue).toEqual({ name: "Madurai Traders & Co" });
  });

  it("logs nothing when the form is saved unchanged", async () => {
    const supplier = await createSupplier(db, storeId, base, { userId, deviceId });
    await updateSupplier(db, supplier.id, { ...base }, { userId, deviceId });
    expect(await entries("supplier_updated")).toHaveLength(0);
  });

  it("records deactivation and reactivation, and not a repeat of the current state", async () => {
    const supplier = await createSupplier(db, storeId, base, { userId, deviceId });

    await setSupplierActive(db, supplier.id, false, { userId, deviceId });
    await setSupplierActive(db, supplier.id, false, { userId, deviceId });
    await setSupplierActive(db, supplier.id, true, { userId, deviceId });

    const [deactivated, ...extra] = await entries("supplier_deactivated");
    expect(extra).toHaveLength(0);
    expect(deactivated?.oldValue).toEqual({ name: "Madurai Traders", isActive: true });
    expect(deactivated?.newValue).toEqual({ name: "Madurai Traders", isActive: false });
    expect(await entries("supplier_reactivated")).toHaveLength(1);
  });

  it("joins a caller's transaction, so a rolled-back change takes its entry with it", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await createSupplier(trx, storeId, base, { userId, deviceId });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await listSuppliers(db, storeId, true)).toHaveLength(0);
    expect(await entries("supplier_created")).toHaveLength(0);
  });
});

describe("diffSupplierFields", () => {
  it("returns empty objects when nothing changed", () => {
    const fields = { name: "A", phone: null, email: null, address: null, gstin: null, notes: null };
    expect(diffSupplierFields(fields, { ...fields })).toEqual({ oldValue: {}, newValue: {} });
  });

  it("treats clearing a field as a change", () => {
    const before = { name: "A", phone: "1", email: null, address: null, gstin: null, notes: null };
    expect(diffSupplierFields(before, { ...before, phone: null })).toEqual({
      oldValue: { phone: "1" },
      newValue: { phone: null },
    });
  });
});
