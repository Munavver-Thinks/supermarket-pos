import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "./connection.js";
import { runMigrations } from "./migrator.js";
import { listAuditLog } from "./repositories/auditLog.js";
import { seedFirstRun } from "./repositories/seed.js";
import {
  buildBackupRestoredEntry,
  inspectPendingRestore,
  parseRestoreMarker,
  recordBackupRestored,
  removeRestoreMarkerSync,
  serializeRestoreMarker,
  sha256FileSync,
  writeRestoreMarkerSync,
  type RestoreMarker,
} from "./restoreMarker.js";

const HASH = "a".repeat(64);

function marker(overrides: Partial<RestoreMarker> = {}): RestoreMarker {
  return {
    version: 1,
    actingUserId: "8c5b6f0e-4b43-4a55-9a53-2f5d8d3f1d11",
    actorName: "Owner",
    backupName: "pos-2026-09-01T09-00-00Z.db",
    safetyCopyName: "pos-replaced-1789000000000.db",
    backupSha256: HASH,
    requestedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseRestoreMarker", () => {
  it("reads back what was written", () => {
    expect(parseRestoreMarker(serializeRestoreMarker(marker()))).toEqual(marker());
    expect(parseRestoreMarker(serializeRestoreMarker(marker({ safetyCopyName: null })))).toEqual(
      marker({ safetyCopyName: null }),
    );
  });

  it("rejects corrupt or truncated files instead of throwing", () => {
    expect(parseRestoreMarker("")).toBeNull();
    expect(parseRestoreMarker('{"version":1,"actingUs')).toBeNull();
    expect(parseRestoreMarker("null")).toBeNull();
    expect(parseRestoreMarker("[]")).toBeNull();
  });

  it("rejects markers with missing or malformed fields", () => {
    const text = (m: Record<string, unknown>) => JSON.stringify(m);
    expect(parseRestoreMarker(text({ ...marker(), version: 2 }))).toBeNull();
    expect(parseRestoreMarker(text({ ...marker(), actingUserId: "" }))).toBeNull();
    expect(parseRestoreMarker(text({ ...marker(), backupName: undefined }))).toBeNull();
    expect(parseRestoreMarker(text({ ...marker(), backupSha256: "not-a-hash" }))).toBeNull();
    expect(parseRestoreMarker(text({ ...marker(), requestedAt: "yesterday" }))).toBeNull();
    expect(parseRestoreMarker(text({ ...marker(), safetyCopyName: 5 }))).toBeNull();
  });
});

describe("inspectPendingRestore", () => {
  let dir: string;
  let markerPath: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pos-restore-"));
    markerPath = path.join(dir, "pending-restore.json");
    dbPath = path.join(dir, "pos.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports nothing pending when there is no marker", () => {
    expect(inspectPendingRestore(markerPath, dbPath)).toEqual({ status: "none" });
  });

  it("flags an unparseable marker as invalid", () => {
    writeFileSync(markerPath, "{ garbage");
    expect(inspectPendingRestore(markerPath, dbPath).status).toBe("invalid");
  });

  it("confirms a restore when the live file matches the backup it names", () => {
    const backupPath = path.join(dir, "pos-backup.db");
    writeFileSync(backupPath, "restored contents");
    writeFileSync(dbPath, "restored contents");
    writeRestoreMarkerSync(markerPath, marker({ backupSha256: sha256FileSync(backupPath) }));

    const result = inspectPendingRestore(markerPath, dbPath);
    expect(result.status).toBe("applied");
  });

  it("does not confirm a restore that never replaced the file", () => {
    const backupPath = path.join(dir, "pos-backup.db");
    writeFileSync(backupPath, "restored contents");
    writeFileSync(dbPath, "the data from before");
    writeRestoreMarkerSync(markerPath, marker({ backupSha256: sha256FileSync(backupPath) }));

    expect(inspectPendingRestore(markerPath, dbPath).status).toBe("not_applied");
  });

  it("does not confirm a restore when there is no database file at all", () => {
    writeRestoreMarkerSync(markerPath, marker());
    expect(inspectPendingRestore(markerPath, dbPath).status).toBe("not_applied");
  });

  it("writes the marker whole and removes it without throwing, even twice", () => {
    writeRestoreMarkerSync(markerPath, marker());
    expect(existsSync(`${markerPath}.tmp`)).toBe(false);
    removeRestoreMarkerSync(markerPath);
    removeRestoreMarkerSync(markerPath);
    expect(existsSync(markerPath)).toBe(false);
  });
});

describe("recordBackupRestored", () => {
  let db: Db;
  let storeId: string;
  let ownerId: string;

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
    ownerId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("logs the restore against the person who asked for it", async () => {
    await recordBackupRestored(db, marker({ actingUserId: ownerId }), { storeId, deviceId: "device-1" });

    const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "backup_restored" });
    expect(entry?.userId).toBe(ownerId);
    expect(entry?.userName).toBe("Owner");
    expect(entry?.deviceId).toBe("device-1");
    expect(entry?.recordId).toBe("pos-2026-09-01T09-00-00Z.db");
    expect(entry?.newValue).toMatchObject({
      backupName: "pos-2026-09-01T09-00-00Z.db",
      safetyCopyName: "pos-replaced-1789000000000.db",
      actorInRestoredDb: true,
      requestedAt: "2026-09-14T10:00:00.000Z",
    });
  });

  it("still logs the restore, with the name carried over, when that account isn't in the restored data", async () => {
    const missingId = "0f0e0d0c-0b0a-4908-8706-050403020100";
    await recordBackupRestored(db, marker({ actingUserId: missingId, actorName: "Priya" }), {
      storeId,
      deviceId: null,
    });

    const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "backup_restored" });
    expect(entry?.userId).toBe(missingId);
    // The log's left join finds no user, so the name column is empty…
    expect(entry?.userName).toBeNull();
    // …and the entry itself says who it was.
    expect(entry?.newValue).toMatchObject({ actorName: "Priya", actorInRestoredDb: false });
  });

  it("builds the entry without touching the database", () => {
    const entry = buildBackupRestoredEntry(marker(), { storeId: "s", deviceId: null, actorInRestoredDb: true });
    expect(entry).toMatchObject({ storeId: "s", action: "backup_restored", tableName: "database", oldValue: null });
  });
});
