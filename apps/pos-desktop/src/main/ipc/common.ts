import { usersRepo, type Db } from "@pos/database";
import type { User } from "@pos/types";
import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import { getActivationStatus } from "../activation.js";
import type { DeviceConfig } from "../deviceConfig.js";
import { reportError } from "../errorReporting.js";

export interface HandlerContext {
  getDb: () => Db;
  deviceConfig: DeviceConfig;
}

/**
 * Prefixed to exported CSV so Excel opens it as UTF-8 and Tamil product names survive
 * instead of arriving as mojibake. Written as an escape because a literal byte-order mark
 * in source is invisible and easy to delete by accident.
 */
export const UTF8_BOM = "\ufeff";

export const NOT_ACTIVATED_MESSAGE = "This device is not activated.";

/**
 * While a new install is unactivated, only activation and error reporting answer. Older
 * installs ("not_activated_legacy") and development runs are never gated.
 */
function blockedByActivation(channel: string): boolean {
  if (getActivationStatus()?.status !== "unactivated") return false;
  return !channel.startsWith("activation:") && !channel.startsWith("errors:");
}

/**
 * Wraps every handler so a bug never crashes the renderer's IPC call or the app — it always
 * resolves an error shape. Also refuses every channel but activation while the device is
 * unactivated.
 */
export function safeHandle<TArgs extends unknown[], TResult>(
  ctx: HandlerContext,
  channelContext: string,
  handler: (db: Db, ...args: TArgs) => Promise<TResult>,
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult | { ok: false; error: string }> {
  return async (_event, ...args: TArgs) => {
    if (blockedByActivation(channelContext)) return { ok: false, error: NOT_ACTIVATED_MESSAGE };
    try {
      return await handler(ctx.getDb(), ...args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { ok: false, error: "Invalid request: " + error.issues.map((i) => i.message).join(", ") };
      }
      const errorId = reportError(
        ctx.getDb(),
        { storeId: ctx.deviceConfig.storeId, userId: null, context: channelContext },
        error,
      );
      return { ok: false, error: `Something went wrong (ref: ${errorId})` };
    }
  };
}

/**
 * Re-reads whoever the renderer says is acting. The id the screen sends is only a claim —
 * the role, active flag and store all come from the database. Returns the user, or the
 * message to show.
 */
export async function getStoreActor(
  db: Db,
  ctx: HandlerContext,
  actingUserId: string,
): Promise<User | { error: string }> {
  const actor = await usersRepo.getById(db, actingUserId);
  if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
    return { error: "You are not signed in to this store." };
  }
  return actor;
}
