import { randomUUID } from "node:crypto";

import { createDb, runMigrations, seedRepo, usersRepo, type Db } from "@pos/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUserTheme, setUserTheme, type ThemeScope } from "./uiTheme.js";

const DEFAULTS = { set: "calm", mode: "day", highContrast: false };
const VIVID_NIGHT = { set: "vivid", mode: "night", highContrast: false };
const CALM_AUTO_HC = { set: "calm", mode: "auto", highContrast: true };

describe("per-user theme", () => {
  let db: Db;
  let scope: ThemeScope;
  let storeId: string;
  let ownerId: string;
  let cashierId: string;

  async function addUser(username: string, inStore = storeId): Promise<string> {
    const id = randomUUID();
    await usersRepo.createUser(db, {
      id,
      storeId: inStore,
      username,
      passwordHash: "x",
      displayName: username,
      role: "cashier",
    });
    return id;
  }

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedRepo.seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: "x",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    ownerId = seed.ownerUserId;
    scope = { storeId, deviceId: seed.deviceId };
    cashierId = await addUser("cashier");
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("returns the defaults before anything is saved", async () => {
    expect(await getUserTheme(db, scope, ownerId)).toEqual(DEFAULTS);
  });

  it("round-trips a saved theme", async () => {
    expect(await setUserTheme(db, scope, VIVID_NIGHT, ownerId)).toEqual({ ok: true });
    expect(await getUserTheme(db, scope, ownerId)).toEqual(VIVID_NIGHT);
  });

  it("keeps each user's theme separate", async () => {
    await setUserTheme(db, scope, VIVID_NIGHT, ownerId);
    expect(await getUserTheme(db, scope, cashierId)).toEqual(DEFAULTS);
    await setUserTheme(db, scope, CALM_AUTO_HC, cashierId);
    expect(await getUserTheme(db, scope, ownerId)).toEqual(VIVID_NIGHT);
    expect(await getUserTheme(db, scope, cashierId)).toEqual(CALM_AUTO_HC);
  });

  it("refuses an inactive actor and saves nothing", async () => {
    await usersRepo.setUserActive(db, cashierId, false);
    const result = await setUserTheme(db, scope, VIVID_NIGHT, cashierId);
    expect(result).toEqual({ ok: false, error: "You are not signed in to this store." });
    expect(await db.selectFrom("appSettings").selectAll().where("key", "like", "ui.theme.%").execute()).toEqual([]);
  });

  it("refuses an actor from another store, and shows them no theme", async () => {
    const organization = await db.selectFrom("stores").select("organizationId").where("id", "=", storeId).executeTakeFirstOrThrow();
    const otherStore = randomUUID();
    await db
      .insertInto("stores")
      .values({ id: otherStore, organizationId: organization.organizationId, name: "Other", address: null, gstin: null, stateCode: null })
      .execute();
    const stranger = await addUser("stranger", otherStore);
    const result = await setUserTheme(db, scope, VIVID_NIGHT, stranger);
    expect(result).toEqual({ ok: false, error: "You are not signed in to this store." });
    expect(await getUserTheme(db, scope, stranger)).toEqual(DEFAULTS);
  });

  it("returns the defaults for an unknown or inactive user instead of their data", async () => {
    await setUserTheme(db, scope, VIVID_NIGHT, cashierId);
    await usersRepo.setUserActive(db, cashierId, false);
    expect(await getUserTheme(db, scope, cashierId)).toEqual(DEFAULTS);
    expect(await getUserTheme(db, scope, randomUUID())).toEqual(DEFAULTS);
  });

  it("rejects malformed requests", async () => {
    await expect(setUserTheme(db, scope, { set: "neon", mode: "day", highContrast: false }, ownerId)).rejects.toThrow();
    await expect(setUserTheme(db, scope, { ...DEFAULTS, extra: 1 }, ownerId)).rejects.toThrow();
    await expect(getUserTheme(db, scope, "not-a-uuid")).rejects.toThrow();
  });

  it("writes an audit entry with old and new values", async () => {
    await setUserTheme(db, scope, VIVID_NIGHT, ownerId);
    await setUserTheme(db, scope, CALM_AUTO_HC, ownerId);
    const rows = await db
      .selectFrom("auditLogs")
      .selectAll()
      .where("action", "=", "setting_changed")
      .where("recordId", "=", `ui.theme.${ownerId}`)
      .orderBy("createdAt")
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.tableName).toBe("app_settings");
    expect(rows[1]?.userId).toBe(ownerId);
    expect(JSON.parse(JSON.parse(String(rows[1]?.oldValue)) as string)).toEqual(VIVID_NIGHT);
    expect(JSON.parse(JSON.parse(String(rows[1]?.newValue)) as string)).toEqual(CALM_AUTO_HC);
  });
});
