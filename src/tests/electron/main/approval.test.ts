import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { createDb, runMigrations, seedRepo, usersRepo, type Db } from "@pos/database";
import type { UserRole } from "@pos/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APPROVAL_REFUSED_MESSAGE, APPROVAL_REQUIRED_MESSAGE, resolveApproval } from "../../../../electron/main/approval.js";
import { TOO_MANY_ATTEMPTS_MESSAGE } from "../../../../electron/main/attemptThrottle.js";

// Cheap hashes keep the suite fast; bcrypt.compare reads the cost from the hash itself.
const hash = (password: string) => bcrypt.hash(password, 4);

describe("resolveApproval", () => {
  let db: Db;
  let storeId: string;
  let organizationId: string;
  let ownerId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedRepo.seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: await hash("owner-pass"),
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    organizationId = seed.organizationId;
    ownerId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function addUser(username: string, role: UserRole, password: string, inStore = storeId): Promise<string> {
    const id = randomUUID();
    await usersRepo.createUser(db, {
      id,
      storeId: inStore,
      username,
      passwordHash: await hash(password),
      displayName: username,
      role,
    });
    return id;
  }

  async function refusalRows() {
    return db.selectFrom("auditLogs").selectAll().where("action", "=", "approval_refused").execute();
  }

  it("asks for a manager when a cashier sends no approver, and audits nothing yet", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    const outcome = await resolveApproval(db, { storeId, actingUserId: cashier, action: "sale_return" });
    expect(outcome).toEqual({ ok: false, approvalRequired: true, error: APPROVAL_REQUIRED_MESSAGE });
    expect(await refusalRows()).toHaveLength(0);
  });

  it("lets a manager approve their own action without a prompt", async () => {
    const manager = await addUser("manager", "manager", "mgr-pass");
    const outcome = await resolveApproval(db, { storeId, actingUserId: manager, action: "below_cost_discount" });
    expect(outcome).toEqual({ ok: true, approvedByUserId: manager, selfApproved: true });
  });

  it("records the manager who approved a cashier's return", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    const manager = await addUser("manager", "manager", "mgr-pass");
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "manager", password: "mgr-pass" },
    });
    expect(outcome).toEqual({ ok: true, approvedByUserId: manager, selfApproved: false });
  });

  it("accepts the owner as approver", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "below_cost_discount",
      approver: { username: "owner", password: "owner-pass" },
    });
    expect(outcome).toEqual({ ok: true, approvedByUserId: ownerId, selfApproved: false });
  });

  it("refuses another cashier as approver", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("cashier2", "cashier", "other-pass");
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "cashier2", password: "other-pass" },
    });
    expect(outcome).toEqual({ ok: false, approvalRequired: true, error: APPROVAL_REFUSED_MESSAGE });
  });

  it("refuses a wrong password and an unknown username with the same message", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("manager", "manager", "mgr-pass");
    const wrong = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "manager", password: "nope" },
    });
    const unknown = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "ghost", password: "nope" },
    });
    expect(wrong).toEqual({ ok: false, approvalRequired: true, error: APPROVAL_REFUSED_MESSAGE });
    expect(unknown).toEqual(wrong);
  });

  it("refuses an inactive manager", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    const manager = await addUser("manager", "manager", "mgr-pass");
    await db.updateTable("users").set({ isActive: 0 }).where("id", "=", manager).execute();
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "manager", password: "mgr-pass" },
    });
    expect(outcome.ok).toBe(false);
  });

  it("refuses a manager from another store", async () => {
    const otherStore = randomUUID();
    await db
      .insertInto("stores")
      .values({ id: otherStore, organizationId, name: "Other", address: null, gstin: null, stateCode: null })
      .execute();
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("faraway", "manager", "mgr-pass", otherStore);
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "sale_return",
      approver: { username: "faraway", password: "mgr-pass" },
    });
    expect(outcome).toEqual({ ok: false, approvalRequired: true, error: APPROVAL_REFUSED_MESSAGE });
  });

  it("refuses an actor who is inactive or from another store, without asking for approval", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await db.updateTable("users").set({ isActive: 0 }).where("id", "=", cashier).execute();
    const inactive = await resolveApproval(db, { storeId, actingUserId: cashier, action: "sale_return" });
    expect(inactive).toMatchObject({ ok: false, approvalRequired: false });

    const missing = await resolveApproval(db, { storeId, actingUserId: randomUUID(), action: "sale_return" });
    expect(missing).toMatchObject({ ok: false, approvalRequired: false });

    const wrongStore = await resolveApproval(db, { storeId: randomUUID(), actingUserId: ownerId, action: "sale_return" });
    expect(wrongStore).toMatchObject({ ok: false, approvalRequired: false });
  });

  it("refuses a cashier's stock adjustment outright, even with a manager present", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("manager", "manager", "mgr-pass");
    const outcome = await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "stock_adjustment",
      approver: { username: "manager", password: "mgr-pass" },
    });
    expect(outcome).toEqual({ ok: false, approvalRequired: false, error: "Your role can't adjust stock." });
  });

  it("asks inventory staff for approval on a stock adjustment", async () => {
    const staff = await addUser("stock", "inventory_staff", "stock-pass");
    const outcome = await resolveApproval(db, { storeId, actingUserId: staff, action: "stock_adjustment" });
    expect(outcome).toMatchObject({ ok: false, approvalRequired: true });
  });

  it("locks the approver out after five failures, even for the right password", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("manager", "manager", "mgr-pass");
    const attempt = (password: string) =>
      resolveApproval(db, {
        storeId,
        actingUserId: cashier,
        action: "sale_return",
        approver: { username: "manager", password },
      });

    for (let i = 0; i < 5; i++) {
      expect(await attempt(`guess-${i}`)).toMatchObject({ error: APPROVAL_REFUSED_MESSAGE });
    }
    expect(await attempt("mgr-pass")).toEqual({ ok: false, approvalRequired: true, error: TOO_MANY_ATTEMPTS_MESSAGE });

    const rows = await refusalRows();
    expect(rows).toHaveLength(6);
    expect(JSON.parse(rows.find((r) => r.newValue?.includes('"lockedOut":true'))?.newValue ?? "null")).toEqual({
      action: "sale_return",
      approverUsername: "manager",
      lockedOut: true,
    });
  });

  it("audits a bad-credential refusal without the password", async () => {
    const cashier = await addUser("cashier", "cashier", "cash-pass");
    await addUser("manager", "manager", "mgr-pass");
    await resolveApproval(db, {
      storeId,
      actingUserId: cashier,
      action: "below_cost_discount",
      approver: { username: "manager", password: "secret-guess-123" },
      deviceId: "device-1",
    });

    const rows = await refusalRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.userId).toBe(cashier);
    expect(row?.recordId).toBe(cashier);
    expect(row?.deviceId).toBe("device-1");
    expect(JSON.parse(row?.newValue ?? "null")).toEqual({
      action: "below_cost_discount",
      approverUsername: "manager",
      lockedOut: false,
    });

    const everything = await db.selectFrom("auditLogs").selectAll().execute();
    for (const r of everything) {
      expect(JSON.stringify(r)).not.toContain("secret-guess-123");
      expect(JSON.stringify(r)).not.toContain("$2");
    }
  });
});
