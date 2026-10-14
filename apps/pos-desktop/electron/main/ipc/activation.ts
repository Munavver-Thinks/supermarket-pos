import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { getActivationStatus, setActivationStatus } from "../activation.js";
import { activateDevice } from "../activationService.js";
import { ACTIVATION_PUBLIC_KEYS } from "../activationPublicKey.js";
import { writeDeviceConfig } from "../deviceConfig.js";

import { safeHandle, type HandlerContext } from "./common.js";

/**
 * Activation is answered in every state, unactivated included — it is the way out of it.
 * No audit entry: nobody is signed in yet. The devices row records when it happened.
 */
export function registerActivationHandlers(
  ctx: HandlerContext,
  build: { isPackaged: boolean; forceActivation: boolean },
): void {
  ipcMain.handle(
    IPC_CHANNELS.activationGetStatus,
    safeHandle(ctx, IPC_CHANNELS.activationGetStatus, async () => getActivationStatus()),
  );

  ipcMain.handle(
    IPC_CHANNELS.activationActivate,
    safeHandle(ctx, IPC_CHANNELS.activationActivate, async (db, rawKey: unknown) => {
      const key = z.string().min(1).max(4000).parse(rawKey);
      const result = await activateDevice(db, ctx.deviceConfig, key, {
        ...build,
        publicKeys: ACTIVATION_PUBLIC_KEYS,
        saveConfig: writeDeviceConfig,
      });
      if (!result.ok) return { ok: false, error: result.error };
      setActivationStatus(result.activation);
      return { ok: true, activation: result.activation };
    }),
  );
}
