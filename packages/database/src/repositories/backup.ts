import { sql } from "kysely";

import type { Db } from "../connection.js";

/**
 * Writes a consistent copy of the entire database to destPath.
 *
 * Uses SQLite's own `VACUUM INTO` rather than copying the file: the live database runs in
 * WAL mode, so recent commits may still be sitting in the -wal sidecar and a plain file
 * copy can land mid-transaction. VACUUM INTO takes a checkpointed, defragmented snapshot
 * while the app keeps running, and needs no exclusive lock on the source.
 *
 * The destination must not already exist — SQLite refuses to overwrite, which is the
 * behaviour we want for timestamped backup files.
 */
export async function backupDatabaseTo(db: Db, destPath: string): Promise<void> {
  await sql`VACUUM INTO ${sql.lit(destPath)}`.execute(db);
}
