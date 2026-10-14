import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { backupDatabaseTo } from "@/core/database/repositories/backup.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

describe("backupDatabaseTo", () => {
  let db: Db;
  let dir: string;
  let storeId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "pos-backup-"));
    db = createDb({ filePath: join(dir, "pos.db") });
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
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a backup that opens and carries the data", async () => {
    const dest = join(dir, "backup.db");
    await backupDatabaseTo(db, dest);

    expect(statSync(dest).size).toBeGreaterThan(0);

    const restored = createDb({ filePath: dest });
    try {
      const store = await restored.selectFrom("stores").selectAll().where("id", "=", storeId).executeTakeFirst();
      expect(store?.name).toBe("Test Store");

      const users = await restored.selectFrom("users").selectAll().execute();
      expect(users).toHaveLength(1);
    } finally {
      await restored.destroy();
    }
  });

  it("captures writes made right before the backup, including uncheckpointed ones", async () => {
    await db
      .insertInto("categories")
      .values({ id: "cat-1", storeId, name: "Late Addition", parentId: null })
      .execute();

    const dest = join(dir, "late.db");
    await backupDatabaseTo(db, dest);

    const restored = createDb({ filePath: dest });
    try {
      const category = await restored.selectFrom("categories").selectAll().where("id", "=", "cat-1").executeTakeFirst();
      expect(category?.name).toBe("Late Addition");
    } finally {
      await restored.destroy();
    }
  });

  it("refuses to overwrite an existing file rather than silently replacing a backup", async () => {
    const dest = join(dir, "once.db");
    await backupDatabaseTo(db, dest);
    await expect(backupDatabaseTo(db, dest)).rejects.toThrow();
  });
});
