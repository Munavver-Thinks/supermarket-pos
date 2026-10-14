import fs from "node:fs";
import path from "node:path";

import {
  backupDatabaseTo,
  removeRestoreMarkerSync,
  RESTORE_MARKER_FILE_NAME,
  sha256FileSync,
  writeRestoreMarkerSync,
  type Db,
} from "@pos/database";

import { getBackupDir, getDbFilePath } from "./paths.js";

/** How many timestamped backups to keep before the oldest are pruned. */
const KEEP_BACKUPS = 14;

const FILE_PREFIX = "pos-";
const FILE_SUFFIX = ".db";

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

/** e.g. "pos-2026-09-14T10-32-05.db" — sortable, and legal on Windows (no colons). */
function backupFileName(now: Date): string {
  return `${FILE_PREFIX}${now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z")}${FILE_SUFFIX}`;
}

function ensureBackupDir(): string {
  const dir = getBackupDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Rejects anything that isn't one of our own generated names, so a crafted name can't escape the folder. */
function isBackupName(name: string): boolean {
  return name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX) && !name.includes("/") && !name.includes("\\");
}

export function listBackups(): BackupFile[] {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Takes a snapshot now, then prunes the oldest beyond KEEP_BACKUPS. */
export async function runBackup(db: Db): Promise<BackupFile> {
  const dir = ensureBackupDir();
  const name = backupFileName(new Date());
  await backupDatabaseTo(db, path.join(dir, name));

  for (const stale of listBackups().slice(KEEP_BACKUPS)) {
    fs.rmSync(path.join(dir, stale.name), { force: true });
  }

  const created = listBackups().find((b) => b.name === name);
  if (!created) throw new Error("Backup file was written but could not be read back.");
  return created;
}

/**
 * Runs a backup only if none exists from today, so a shop that opens the app every morning
 * gets one automatic copy a day without a scheduler. Never throws — a failed backup must
 * not stop the app from opening.
 */
export async function runDailyBackupIfDue(db: Db): Promise<BackupFile | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (listBackups().some((b) => b.createdAt.slice(0, 10) === today)) return null;
    return await runBackup(db);
  } catch (error) {
    console.error("Daily backup failed:", error);
    return null;
  }
}

/** Next to the database, so it lives and dies with this install's data directory. */
export function getRestoreMarkerPath(): string {
  return path.join(path.dirname(getDbFilePath()), RESTORE_MARKER_FILE_NAME);
}

/**
 * Replaces the live database with a backup. The caller must have closed the database
 * first, and must restart the app afterwards — nothing may hold the old file open.
 *
 * The restore can't be audited now: the entry would be written into the file about to be
 * replaced. So a marker is left beside the database and the next boot records it into the
 * restored data (see bootstrap). The order below is what keeps that honest:
 *   1. hash the backup — a backup that can't be read fails before anything changes;
 *   2. keep a safety copy of the current data;
 *   3. write the marker, carrying the backup's hash;
 *   4. copy the backup over the live file — if this throws, the marker is removed.
 * If the process dies between 3 and 4, or step 4 half-writes, the live file won't match the
 * hash and boot discards the marker instead of logging a restore that didn't happen.
 *
 * The -wal and -shm sidecars are deleted deliberately: they belong to the database being
 * replaced, and leaving them behind would let SQLite replay a stale write-ahead log over
 * the restored file and corrupt it.
 */
export function restoreBackup(name: string, actor: { id: string; displayName: string }): void {
  if (!isBackupName(name)) {
    throw new Error("That is not a recognised backup file.");
  }

  const source = path.join(getBackupDir(), name);
  if (!fs.existsSync(source)) {
    throw new Error("That backup no longer exists.");
  }

  const target = getDbFilePath();
  const markerPath = getRestoreMarkerPath();
  const backupSha256 = sha256FileSync(source);

  // Keep the database we are about to replace, so a restore from the wrong file is survivable.
  let safetyCopyName: string | null = null;
  if (fs.existsSync(target)) {
    safetyCopyName = `${FILE_PREFIX}replaced-${Date.now()}${FILE_SUFFIX}`;
    fs.copyFileSync(target, path.join(ensureBackupDir(), safetyCopyName));
  }

  writeRestoreMarkerSync(markerPath, {
    version: 1,
    actingUserId: actor.id,
    actorName: actor.displayName,
    backupName: name,
    safetyCopyName,
    backupSha256,
    requestedAt: new Date().toISOString(),
  });

  try {
    fs.copyFileSync(source, target);
  } catch (error) {
    removeRestoreMarkerSync(markerPath);
    throw error;
  }

  // Past this point the file has been replaced, so the marker stays even if cleanup fails.
  fs.rmSync(`${target}-wal`, { force: true });
  fs.rmSync(`${target}-shm`, { force: true });
}
