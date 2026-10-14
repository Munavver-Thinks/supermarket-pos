import { randomUUID } from "node:crypto";

import type { AuditActivityEntry } from "@pos/types";

import type { Db } from "../connection.js";

export interface AuditEntryInput {
  storeId: string;
  userId: string;
  deviceId: string | null;
  action: string;
  tableName: string;
  recordId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
}

/**
 * Append-only. No update/delete is exposed on purpose.
 *
 * Pass the transaction the change itself is written in, not the bare database. An audit row
 * written after the change commits can be lost to a crash in between, which leaves exactly
 * the record the log exists to explain with no explanation.
 */
export async function appendAuditLog(db: Db, input: AuditEntryInput): Promise<void> {
  await db
    .insertInto("auditLogs")
    .values({
      id: randomUUID(),
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: input.action,
      tableName: input.tableName,
      recordId: input.recordId,
      oldValue: input.oldValue === undefined || input.oldValue === null ? null : JSON.stringify(input.oldValue),
      newValue: input.newValue === undefined || input.newValue === null ? null : JSON.stringify(input.newValue),
      reason: input.reason,
    })
    .execute();
}

/** Newest first. `beforeIso` pages backwards from an entry already shown. */
export async function listAuditLog(
  db: Db,
  storeId: string,
  options: { limit: number; beforeIso?: string | undefined; action?: string | undefined },
): Promise<AuditActivityEntry[]> {
  let query = db
    .selectFrom("auditLogs as a")
    .leftJoin("users as u", "u.id", "a.userId")
    .where("a.storeId", "=", storeId);

  if (options.beforeIso) query = query.where("a.createdAt", "<", options.beforeIso);
  if (options.action) query = query.where("a.action", "=", options.action);

  const rows = await query
    .orderBy("a.createdAt", "desc")
    .limit(options.limit)
    .select([
      "a.id as id",
      "a.action as action",
      "a.tableName as tableName",
      "a.recordId as recordId",
      "a.oldValue as oldValue",
      "a.newValue as newValue",
      "a.reason as reason",
      "a.userId as userId",
      "u.displayName as userName",
      "a.deviceId as deviceId",
      "a.createdAt as createdAt",
    ])
    .execute();

  return rows.map((r) => ({ ...r, oldValue: parseJson(r.oldValue), newValue: parseJson(r.newValue) }));
}

/** A value that fails to parse is shown as the raw text rather than dropped. */
function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
