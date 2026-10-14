import { randomUUID } from "node:crypto";

import { errorLogRepo, type Db } from "@pos/database";

/**
 * Per Rule "AI/hardware/background failures must never stop billing": this is the one
 * place unexpected errors land. It logs to the console and best-effort to the local DB's
 * append-only error_logs table, then always returns — it never rethrows.
 */
export function reportError(
  db: Db | undefined,
  context: { storeId: string | null; userId: string | null; context: string },
  error: unknown,
): string {
  const errorId = randomUUID();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;

  console.error(`[${errorId}] (${context.context})`, message, stack ?? "");

  if (db) {
    errorLogRepo
      .appendErrorLog(db, {
        errorId,
        storeId: context.storeId,
        userId: context.userId,
        message,
        stack,
        context: context.context,
      })
      .catch((dbError: unknown) => {
        console.error("Failed to persist error log entry", dbError);
      });
  }

  return errorId;
}

/**
 * `onReported` lets the caller tell open windows about the error (its reference id), so the
 * counter sees "Something went wrong (ref: …)" instead of nothing. It must not throw; if it
 * does, that is swallowed too.
 */
export function installGlobalErrorHandlers(
  getDb: () => Db | undefined,
  onReported?: (errorId: string) => void,
): void {
  const notify = (errorId: string): void => {
    try {
      onReported?.(errorId);
    } catch (notifyError) {
      console.error("Failed to notify windows of an error", notifyError);
    }
  };
  process.on("uncaughtException", (error) => {
    notify(reportError(getDb(), { storeId: null, userId: null, context: "uncaughtException" }, error));
  });
  process.on("unhandledRejection", (error) => {
    notify(reportError(getDb(), { storeId: null, userId: null, context: "unhandledRejection" }, error));
  });
}

/**
 * Caps how many renderer errors are written per minute. A render loop that throws on every
 * frame would otherwise fill error_logs in seconds; past the cap the last reference id is
 * handed back without storing anything new, so the screen still has an id to show.
 */
export function createRendererErrorLimiter(
  max = 20,
  windowMs = 60_000,
  now: () => number = () => Date.now(),
): (report: () => string) => { errorId: string; stored: boolean } {
  const times: number[] = [];
  let lastId: string | null = null;
  return (report) => {
    const at = now();
    while (times.length > 0 && at - (times[0] ?? at) >= windowMs) times.shift();
    if (times.length >= max && lastId !== null) return { errorId: lastId, stored: false };
    times.push(at);
    lastId = report();
    return { errorId: lastId, stored: true };
  };
}
