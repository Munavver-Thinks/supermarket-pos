import type { Db } from "@pos/database";
import type { ActivationInfo } from "@pos/types";

import {
  computeRequestCode,
  resolveActivationStatus,
  setActivationStatus,
  verifyActivationKey,
} from "./activation.js";
import type { DeviceConfig } from "./deviceConfigFile.js";

/** Electron-free steps around activation.ts, so the whole flow is unit-tested. */

export interface ActivationBuild {
  isPackaged: boolean;
  forceActivation: boolean;
  publicKeys: readonly string[];
}

/** Resolves and remembers the device's state at boot. Changes nothing on disk. */
export function initActivation(config: DeviceConfig, build: ActivationBuild): ActivationInfo {
  const info = resolveActivationStatus({ config, ...build });
  setActivationStatus(info);
  return info;
}

/**
 * Checks a key and, only if it fits this device, stores it: on the devices row (with the
 * time) and in device-config.json (written atomically). A key that fails changes nothing.
 * `config` is the live in-memory config and is updated too, so no restart is needed.
 */
export async function activateDevice(
  db: Db,
  config: DeviceConfig,
  key: string,
  build: ActivationBuild & { saveConfig: (config: DeviceConfig) => void },
): Promise<{ ok: true; activation: ActivationInfo } | { ok: false; error: string }> {
  const compact = key.replace(/\s+/g, "");
  const verified = verifyActivationKey(compact, computeRequestCode(config.deviceId), build.publicKeys);
  if (!verified.ok) return { ok: false, error: verified.reason };

  await db
    .updateTable("devices")
    .set({ activationKey: compact, activatedAt: new Date().toISOString() })
    .where("id", "=", config.deviceId)
    .execute();

  const next: DeviceConfig = { ...config, activationKey: compact };
  build.saveConfig(next);
  config.activationKey = compact;

  const activation = resolveActivationStatus({ config: next, ...build });
  return { ok: true, activation };
}
