import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { seedFirstRun } from "./seed.js";
import {
  countActiveOwners,
  createUser,
  findUserByUsername,
  getById,
  getRowById,
  setPasswordHash,
  setUserActive,
  updateUser,
} from "./users.js";

describe("staff repository", () => {
  let db: Db;
  let storeId: string;
  let ownerId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: "owner-hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    ownerId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function addCashier(username = "ravi"): Promise<string> {
    const id = randomUUID();
    await createUser(db, { id, storeId, username, passwordHash: "h", displayName: "Ravi", role: "cashier" });
    return id;
  }

  it("renames and changes role", async () => {
    const id = await addCashier();
    await updateUser(db, id, { displayName: "Ravi K", role: "inventory_staff" });
    expect(await getById(db, id)).toMatchObject({ displayName: "Ravi K", role: "inventory_staff" });
  });

  it("hides a deactivated user from sign-in lookups but keeps the row", async () => {
    const id = await addCashier();
    await setUserActive(db, id, false);
    expect(await findUserByUsername(db, storeId, "ravi")).toBeUndefined();
    expect(await getById(db, id)).toMatchObject({ isActive: false });

    await setUserActive(db, id, true);
    expect(await findUserByUsername(db, storeId, "ravi")).toMatchObject({ id });
  });

  it("replaces the password hash, readable only through getRowById", async () => {
    const id = await addCashier();
    await setPasswordHash(db, id, "new-hash");
    expect((await getRowById(db, id))?.passwordHash).toBe("new-hash");
    expect(await getById(db, id)).not.toHaveProperty("passwordHash");
  });

  it("returns the real creation time with the row", async () => {
    const row = await findUserByUsername(db, storeId, "owner");
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("counts only active owners of the store", async () => {
    expect(await countActiveOwners(db, storeId)).toBe(1);

    const second = randomUUID();
    await createUser(db, { id: second, storeId, username: "owner2", passwordHash: "h", displayName: "O2", role: "owner" });
    await addCashier();
    expect(await countActiveOwners(db, storeId)).toBe(2);

    await setUserActive(db, ownerId, false);
    expect(await countActiveOwners(db, storeId)).toBe(1);
    expect(await countActiveOwners(db, randomUUID())).toBe(0);
  });
});
