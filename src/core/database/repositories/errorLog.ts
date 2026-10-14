import { randomUUID } from "node:crypto";

import type { Db } from "../connection.js";

/** Append-only. Never include passwords, payment secrets, or full request bodies here. */
export async function appendErrorLog(
  db: Db,
  input: {
    errorId: string;
    storeId: string | null;
    userId: string | null;
    message: string;
    stack: string | null;
    context: string | null;
  },
): Promise<void> {
  await db
    .insertInto("errorLogs")
    .values({
      id: randomUUID(),
      errorId: input.errorId,
      storeId: input.storeId,
      userId: input.userId,
      message: input.message,
      stack: input.stack,
      context: input.context,
    })
    .execute();
}
