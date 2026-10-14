import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { createDb, runMigrations, seedRepo, usersRepo, type Db } from "@pos/database";
import type { UserRole } from "@pos/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOO_MANY_ATTEMPTS_MESSAGE } from "./attemptThrottle.js";
import {
  changeOwnPassword,
  createEmployee,
  DEFAULT_OWNER_PASSWORD,
  DEFAULT_OWNER_USERNAME,
  login,
  resetEmployeePassword,
  setEmployeeActive,
  updateEmployee,
} from "./auth.js";

const hash = (password: string) => bcrypt.hash(password, 4);

describe("staff management and sign-in", () => {
  let db: Db;
  let storeId: string;
  let ownerId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedRepo.seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: DEFAULT_OWNER_USERNAME,
      ownerPasswordHash: await hash(DEFAULT_OWNER_PASSWORD),
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    ownerId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function addUser(username: string, role: UserRole, password = `${username}-pass`): Promise<string> {
    const id = randomUUID();
    await usersRepo.createUser(db, {
      id,
      storeId,
      username,
      passwordHash: await hash(password),
      displayName: username.toUpperCase(),
      role,
    });
    return id;
  }

  async function auditRows() {
    return db.selectFrom("auditLogs").selectAll().execute();
  }

  describe("login", () => {
    it("flags the seeded default password and returns the stored creation time", async () => {
      const result = await login(db, storeId, DEFAULT_OWNER_USERNAME, DEFAULT_OWNER_PASSWORD);
      expect(result.ok).toBe(true);
      expect(result.usingDefaultPassword).toBe(true);
      const row = await usersRepo.getRowById(db, ownerId);
      expect(result.user?.createdAt).toBe(row?.createdAt);
    });

    it("does not flag other logins", async () => {
      await addUser("ravi", "cashier", "ravi-secret");
      const result = await login(db, storeId, "ravi", "ravi-secret");
      expect(result).toMatchObject({ ok: true, usingDefaultPassword: false });
    });

    it("refuses a deactivated user", async () => {
      const id = await addUser("ravi", "cashier", "ravi-secret");
      await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: id, isActive: false });
      expect((await login(db, storeId, "ravi", "ravi-secret")).ok).toBe(false);

      await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: id, isActive: true });
      expect((await login(db, storeId, "ravi", "ravi-secret")).ok).toBe(true);
    });

    it("locks a username after five failures, even for the right password", async () => {
      await addUser("ravi", "cashier", "ravi-secret");
      for (let i = 0; i < 5; i++) {
        expect(await login(db, storeId, "ravi", `wrong-${i}`)).toMatchObject({ ok: false });
      }
      expect(await login(db, storeId, "ravi", "ravi-secret")).toEqual({ ok: false, error: TOO_MANY_ATTEMPTS_MESSAGE });
      // Another username is unaffected.
      expect((await login(db, storeId, DEFAULT_OWNER_USERNAME, DEFAULT_OWNER_PASSWORD)).ok).toBe(true);
    });

    it("gives an unknown username the same answer as a wrong password", async () => {
      const unknown = await login(db, storeId, "ghost", "whatever");
      const wrong = await login(db, storeId, DEFAULT_OWNER_USERNAME, "whatever");
      expect(unknown).toEqual(wrong);
    });
  });

  describe("updateEmployee", () => {
    it("lets the owner rename and change a cashier's role, and audits it", async () => {
      const id = await addUser("ravi", "cashier");
      const result = await updateEmployee(db, {
        storeId,
        actingUserId: ownerId,
        userId: id,
        displayName: "Ravi Kumar",
        role: "manager",
      });
      expect(result.ok).toBe(true);
      expect(result.user).toMatchObject({ displayName: "Ravi Kumar", role: "manager" });

      const [row] = (await auditRows()).filter((r) => r.action === "employee_updated");
      expect(JSON.parse(row?.oldValue ?? "null")).toEqual({ displayName: "RAVI", role: "cashier" });
      expect(JSON.parse(row?.newValue ?? "null")).toEqual({ displayName: "Ravi Kumar", role: "manager" });
    });

    it("stops a manager editing an owner or another manager, or promoting anyone", async () => {
      const managerId = await addUser("meena", "manager");
      const otherManager = await addUser("mohan", "manager");
      const cashier = await addUser("ravi", "cashier");

      const onOwner = await updateEmployee(db, { storeId, actingUserId: managerId, userId: ownerId, displayName: "X", role: "owner" });
      expect(onOwner.ok).toBe(false);
      const onPeer = await updateEmployee(db, {
        storeId,
        actingUserId: managerId,
        userId: otherManager,
        displayName: "X",
        role: "manager",
      });
      expect(onPeer.ok).toBe(false);
      const promote = await updateEmployee(db, {
        storeId,
        actingUserId: managerId,
        userId: cashier,
        displayName: "RAVI",
        role: "manager",
      });
      expect(promote.ok).toBe(false);
      const sideways = await updateEmployee(db, {
        storeId,
        actingUserId: managerId,
        userId: cashier,
        displayName: "RAVI",
        role: "inventory_staff",
      });
      expect(sideways.ok).toBe(true);
    });

    it("never demotes the last owner", async () => {
      const second = await addUser("owner2", "owner");
      const demoteFirst = await updateEmployee(db, {
        storeId,
        actingUserId: second,
        userId: ownerId,
        displayName: "Owner",
        role: "manager",
      });
      expect(demoteFirst.ok).toBe(true);

      // `second` is now the only owner; nobody else can make them a manager.
      const promoted = await addUser("owner3", "owner");
      await setEmployeeActive(db, { storeId, actingUserId: second, userId: promoted, isActive: false });
      const demoteLast = await updateEmployee(db, {
        storeId,
        actingUserId: promoted,
        userId: second,
        displayName: "OWNER2",
        role: "manager",
      });
      // The deactivated owner can't act at all.
      expect(demoteLast.ok).toBe(false);
      expect((await usersRepo.getById(db, second))?.role).toBe("owner");
    });

    it("refuses to change your own account here", async () => {
      const result = await updateEmployee(db, {
        storeId,
        actingUserId: ownerId,
        userId: ownerId,
        displayName: "Me",
        role: "cashier",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("setEmployeeActive", () => {
    it("refuses to deactivate yourself or the last owner", async () => {
      expect((await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: ownerId, isActive: false })).ok).toBe(
        false,
      );

      const second = await addUser("owner2", "owner");
      // Two owners: one may deactivate the other.
      expect((await setEmployeeActive(db, { storeId, actingUserId: second, userId: ownerId, isActive: false })).ok).toBe(
        true,
      );
      expect(await usersRepo.countActiveOwners(db, storeId)).toBe(1);
    });

    it("guards the last owner even against another owner's stale session", async () => {
      const second = await addUser("owner2", "owner");
      await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: second, isActive: false });
      // `second` is inactive, so the actor check refuses before the owner count is reached.
      const result = await setEmployeeActive(db, { storeId, actingUserId: second, userId: ownerId, isActive: false });
      expect(result.ok).toBe(false);
      expect((await usersRepo.getById(db, ownerId))?.isActive).toBe(true);
    });

    it("audits deactivation and reactivation", async () => {
      const id = await addUser("ravi", "cashier");
      await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: id, isActive: false });
      await setEmployeeActive(db, { storeId, actingUserId: ownerId, userId: id, isActive: true });
      const actions = (await auditRows()).map((r) => r.action);
      expect(actions).toContain("employee_deactivated");
      expect(actions).toContain("employee_reactivated");
    });

    it("stops a cashier managing anyone", async () => {
      const cashier = await addUser("ravi", "cashier");
      const other = await addUser("sita", "cashier");
      expect((await setEmployeeActive(db, { storeId, actingUserId: cashier, userId: other, isActive: false })).ok).toBe(
        false,
      );
    });
  });

  describe("passwords", () => {
    it("resets a cashier's password so only the new one works", async () => {
      const id = await addUser("ravi", "cashier", "old-secret");
      const result = await resetEmployeePassword(db, {
        storeId,
        actingUserId: ownerId,
        userId: id,
        newPassword: "new-secret",
      });
      expect(result.ok).toBe(true);
      expect((await login(db, storeId, "ravi", "old-secret")).ok).toBe(false);
      expect((await login(db, storeId, "ravi", "new-secret")).ok).toBe(true);
    });

    it("refuses a short password or one equal to the username", async () => {
      const id = await addUser("ravi123", "cashier");
      expect(
        (await resetEmployeePassword(db, { storeId, actingUserId: ownerId, userId: id, newPassword: "abc" })).ok,
      ).toBe(false);
      expect(
        (await resetEmployeePassword(db, { storeId, actingUserId: ownerId, userId: id, newPassword: "RAVI123" })).ok,
      ).toBe(false);
      expect(
        (
          await createEmployee(db, {
            storeId,
            actingUserId: ownerId,
            username: "sita99",
            password: "sita99",
            displayName: "Sita",
            role: "cashier",
          })
        ).ok,
      ).toBe(false);
    });

    it("changes your own password only with the current one", async () => {
      const wrong = await changeOwnPassword(db, {
        storeId,
        actingUserId: ownerId,
        currentPassword: "not-it",
        newPassword: "shop-secret-1",
      });
      expect(wrong).toEqual({ ok: false, error: "The current password is not correct." });

      const right = await changeOwnPassword(db, {
        storeId,
        actingUserId: ownerId,
        currentPassword: DEFAULT_OWNER_PASSWORD,
        newPassword: "shop-secret-1",
      });
      expect(right.ok).toBe(true);

      expect((await login(db, storeId, DEFAULT_OWNER_USERNAME, DEFAULT_OWNER_PASSWORD)).ok).toBe(false);
      const after = await login(db, storeId, DEFAULT_OWNER_USERNAME, "shop-secret-1");
      expect(after).toMatchObject({ ok: true, usingDefaultPassword: false });
    });

    it("never writes a password or hash into the audit log", async () => {
      const id = await addUser("ravi", "cashier", "old-secret");
      await resetEmployeePassword(db, { storeId, actingUserId: ownerId, userId: id, newPassword: "fresh-secret-9" });
      await changeOwnPassword(db, {
        storeId,
        actingUserId: ownerId,
        currentPassword: DEFAULT_OWNER_PASSWORD,
        newPassword: "owner-secret-9",
      });
      await createEmployee(db, {
        storeId,
        actingUserId: ownerId,
        username: "sita",
        password: "sita-secret-9",
        displayName: "Sita",
        role: "cashier",
      });

      const rows = await auditRows();
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining(["password_reset", "password_changed", "employee_created"]),
      );
      const dump = JSON.stringify(rows);
      for (const secret of ["fresh-secret-9", "owner-secret-9", "sita-secret-9", "old-secret", "$2a$", "$2b$"]) {
        expect(dump).not.toContain(secret);
      }
    });
  });
});
