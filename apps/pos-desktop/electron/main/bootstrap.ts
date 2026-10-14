import bcrypt from "bcryptjs";
import {
  createDb,
  createMigrator,
  inspectPendingRestore,
  kiranaCatalogRepo,
  recordBackupRestored,
  removeRestoreMarkerSync,
  runMigrations,
  seedRepo,
  type Db,
  type PendingRestore,
} from "@pos/database";

import { DEFAULT_OWNER_PASSWORD, DEFAULT_OWNER_USERNAME } from "./auth.js";
import { getRestoreMarkerPath, runBackup, runDailyBackupIfDue } from "./backup.js";
import { readDeviceConfig, writeDeviceConfig, type DeviceConfig } from "./deviceConfig.js";
import { reportError } from "./errorReporting.js";
import { getDbFilePath } from "./paths.js";

export { DEFAULT_OWNER_PASSWORD, DEFAULT_OWNER_USERNAME } from "./auth.js";

export interface BootstrapResult {
  db: Db;
  deviceConfig: DeviceConfig;
  isFirstRun: boolean;
}

/**
 * Runs on every app start: opens the local SQLite DB, applies pending migrations, and —
 * on a genuinely fresh install only — seeds an organization/store/device/owner plus a
 * demo product catalog (with real opening stock) so the app is immediately bill-ready,
 * no manual CLI step required. Gated by the presence of device-config.json, so this block
 * only ever runs once per install — safe by construction, never re-seeds on a later
 * launch. A real multi-shop rollout would replace the seed step with a proper first-run
 * setup screen and a licensing/activation check; that's flagged as a fast-follow in the
 * plan, not required for Phase 1.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const dbFilePath = getDbFilePath();
  const markerPath = getRestoreMarkerPath();

  // Checked before the database is opened: opening and migrating write to the file, after
  // which it could no longer be matched against the backup a restore copied in.
  const pendingRestore = inspectPendingRestore(markerPath, dbFilePath);

  const db = createDb({ filePath: dbFilePath });
  await backupBeforeMigrating(db);
  await runMigrations(db);

  const existingConfig = readDeviceConfig();
  await settlePendingRestore(db, pendingRestore, markerPath, existingConfig);

  if (existingConfig) {
    // One automatic copy per day, taken before the shop starts billing into this database.
    await runDailyBackupIfDue(db);
    return { db, deviceConfig: existingConfig, isFirstRun: false };
  }

  const passwordHash = await bcrypt.hash(DEFAULT_OWNER_PASSWORD, 10);
  const seed = await seedRepo.seedFirstRun(db, {
    organizationName: "My Shop Organization",
    storeName: "Main Store",
    deviceName: "Register 1",
    ownerUsername: DEFAULT_OWNER_USERNAME,
    ownerPasswordHash: passwordHash,
    ownerDisplayName: "Owner",
  });

  await kiranaCatalogRepo.seedKiranaCatalog(db, seed.storeId, seed.ownerUserId);

  const deviceConfig: DeviceConfig = {
    organizationId: seed.organizationId,
    storeId: seed.storeId,
    deviceId: seed.deviceId,
    counterId: "counter-1",
    billNoPrefix: "POS",
  };
  writeDeviceConfig(deviceConfig);

  return { db, deviceConfig, isFirstRun: true };
}

/**
 * An upgrade is the one moment a shop's real data meets schema changes it has never run, so a
 * copy is taken first whenever an existing database has migrations still to apply. A fresh
 * install (nothing applied yet) has nothing to lose. Never throws: a failed backup is
 * reported and the app still opens — refusing to start would stop the shop billing.
 */
async function backupBeforeMigrating(db: Db): Promise<void> {
  try {
    const migrations = await createMigrator(db).getMigrations();
    const applied = migrations.some((m) => m.executedAt !== undefined);
    const pending = migrations.some((m) => m.executedAt === undefined);
    if (applied && pending) {
      await runBackup(db);
    }
  } catch (error) {
    reportError(db, { storeId: null, userId: null, context: "bootstrap:preMigrationBackup" }, error);
  }
}

/**
 * Finishes the audit of a restore requested before the last restart (see restoreBackup).
 * Never throws, and always removes the marker: once the restored database has been opened
 * and written to, the marker can no longer be verified, so retrying on a later boot would
 * only ever discard it.
 */
async function settlePendingRestore(
  db: Db,
  pending: PendingRestore,
  markerPath: string,
  config: DeviceConfig | null | undefined,
): Promise<void> {
  if (pending.status === "none") return;
  const storeId = config?.storeId ?? null;
  const context = "bootstrap:pendingRestore";

  try {
    switch (pending.status) {
      case "invalid":
        reportError(db, { storeId, userId: null, context }, new Error(`Discarded restore marker: ${pending.detail}`));
        break;
      case "not_applied":
        // The restore failed or was interrupted before the file was replaced — the data is
        // still what it was, so there is no restore to record.
        reportError(
          db,
          { storeId, userId: pending.marker.actingUserId, context },
          new Error(`Restore of ${pending.marker.backupName} did not complete; nothing was recorded.`),
        );
        break;
      case "applied":
        if (!config) {
          reportError(
            db,
            { storeId: null, userId: pending.marker.actingUserId, context },
            new Error(`Restore of ${pending.marker.backupName} completed but there is no device config to log it under.`),
          );
          break;
        }
        await recordBackupRestored(db, pending.marker, { storeId: config.storeId, deviceId: config.deviceId });
        break;
    }
  } catch (error) {
    reportError(db, { storeId, userId: null, context }, error);
  } finally {
    removeRestoreMarkerSync(markerPath);
  }
}
