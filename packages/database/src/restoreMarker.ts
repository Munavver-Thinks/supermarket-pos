import { createHash } from "node:crypto";
import fs from "node:fs";

import type { Db } from "./connection.js";
import { appendAuditLog, type AuditEntryInput } from "./repositories/auditLog.js";

/**
 * Restoring a backup replaces the whole database file, so an audit entry written before the
 * restore is wiped by it. Instead the restore leaves this small marker beside the database,
 * and the next boot writes the entry into the restored database and removes the marker.
 *
 * Kept here, not in the Electron main process, so the parsing, the "did the restore really
 * happen" check and the entry itself are covered by tests.
 */
export const RESTORE_MARKER_FILE_NAME = "pending-restore.json";

export interface RestoreMarker {
  version: 1;
  actingUserId: string;
  /** Carried because the actor's account may not exist in the restored data. */
  actorName: string;
  backupName: string;
  /** The copy of the data that was replaced; null if there was no live file to keep. */
  safetyCopyName: string | null;
  /**
   * Hash of the backup file. On boot the live database must match it byte for byte, which is
   * how a marker left by a restore that failed or crashed part-way is told apart from one
   * that completed.
   */
  backupSha256: string;
  requestedAt: string;
}

export function serializeRestoreMarker(marker: RestoreMarker): string {
  return JSON.stringify(marker, null, 2);
}

/** Null for anything that isn't a complete marker we wrote — the caller logs and discards it. */
export function parseRestoreMarker(text: string): RestoreMarker | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  const nonEmpty = (x: unknown): x is string => typeof x === "string" && x.length > 0;
  if (v.version !== 1) return null;
  if (!nonEmpty(v.actingUserId) || !nonEmpty(v.actorName) || !nonEmpty(v.backupName)) return null;
  if (!(v.safetyCopyName === null || nonEmpty(v.safetyCopyName))) return null;
  if (typeof v.backupSha256 !== "string" || !/^[0-9a-f]{64}$/.test(v.backupSha256)) return null;
  if (!nonEmpty(v.requestedAt) || Number.isNaN(Date.parse(v.requestedAt))) return null;

  return {
    version: 1,
    actingUserId: v.actingUserId,
    actorName: v.actorName,
    backupName: v.backupName,
    safetyCopyName: v.safetyCopyName,
    backupSha256: v.backupSha256,
    requestedAt: v.requestedAt,
  };
}

/** Streams in chunks so a large shop database isn't read into memory whole. */
export function sha256FileSync(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(filePath, "r");
  try {
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Written to a temporary name and renamed, so a crash mid-write never leaves a half marker behind. */
export function writeRestoreMarkerSync(markerPath: string, marker: RestoreMarker): void {
  const temp = `${markerPath}.tmp`;
  fs.writeFileSync(temp, serializeRestoreMarker(marker), "utf8");
  fs.renameSync(temp, markerPath);
}

/** Never throws — a stuck marker must not stop the shop opening the app. */
export function removeRestoreMarkerSync(markerPath: string): void {
  try {
    fs.rmSync(markerPath, { force: true });
    fs.rmSync(`${markerPath}.tmp`, { force: true });
  } catch (error) {
    console.error("Could not remove the pending-restore marker:", error);
  }
}

export type PendingRestore =
  | { status: "none" }
  | { status: "invalid"; detail: string }
  | { status: "not_applied"; marker: RestoreMarker }
  | { status: "applied"; marker: RestoreMarker };

/**
 * Must run before the database is opened: opening and migrating writes to the file, after
 * which it would no longer match the backup it was restored from. Never throws.
 */
export function inspectPendingRestore(markerPath: string, dbFilePath: string): PendingRestore {
  let text: string;
  try {
    if (!fs.existsSync(markerPath)) return { status: "none" };
    text = fs.readFileSync(markerPath, "utf8");
  } catch (error) {
    return { status: "invalid", detail: `unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }

  const marker = parseRestoreMarker(text);
  if (!marker) return { status: "invalid", detail: "not a valid restore marker" };

  try {
    if (!fs.existsSync(dbFilePath)) return { status: "not_applied", marker };
    return sha256FileSync(dbFilePath) === marker.backupSha256
      ? { status: "applied", marker }
      : { status: "not_applied", marker };
  } catch {
    // If the live file can't even be read, nothing proves the restore happened.
    return { status: "not_applied", marker };
  }
}

export function buildBackupRestoredEntry(
  marker: RestoreMarker,
  context: { storeId: string; deviceId: string | null; actorInRestoredDb: boolean },
): AuditEntryInput {
  return {
    storeId: context.storeId,
    // Kept even when the account is missing from the restored data: the id is still the
    // truth about who did it, and the name below keeps the entry readable.
    userId: marker.actingUserId,
    deviceId: context.deviceId,
    action: "backup_restored",
    tableName: "database",
    recordId: marker.backupName,
    oldValue: null,
    newValue: {
      backupName: marker.backupName,
      safetyCopyName: marker.safetyCopyName,
      actorName: marker.actorName,
      actorInRestoredDb: context.actorInRestoredDb,
      requestedAt: marker.requestedAt,
    },
    reason: null,
  };
}

/** Writes the entry into the restored database. The caller removes the marker afterwards. */
export async function recordBackupRestored(
  db: Db,
  marker: RestoreMarker,
  context: { storeId: string; deviceId: string | null },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const actor = await trx
      .selectFrom("users")
      .select("id")
      .where("id", "=", marker.actingUserId)
      .executeTakeFirst();
    await appendAuditLog(trx, buildBackupRestoredEntry(marker, { ...context, actorInRestoredDb: actor !== undefined }));
  });
}
