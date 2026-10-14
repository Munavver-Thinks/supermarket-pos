import fs from "node:fs";

/**
 * Reading and writing device-config.json, without Electron (so it is unit-tested). The file
 * is this install's identity; a half-written one would stop the app opening, so writes go to
 * a temporary file first and are renamed over the original. Fields this version doesn't know
 * about are kept, so an older app never strips what a newer one wrote.
 */

export interface DeviceConfig {
  organizationId: string;
  storeId: string;
  deviceId: string;
  /** Phase 1 targets one register per install — this is a fixed logical id, not a DB row. */
  counterId: string;
  billNoPrefix: string;
  /** The activation key entered on this device, as issued. */
  activationKey?: string;
  /** Written only by a fresh install of a release that requires activation. See activation.ts. */
  activationRequired?: boolean;
}

const REQUIRED = ["organizationId", "storeId", "deviceId", "counterId", "billNoPrefix"] as const;

export function readDeviceConfigFile(configPath: string): DeviceConfig | undefined {
  if (!fs.existsSync(configPath)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof parsed[key] !== "string") {
      throw new Error(`device-config.json is missing "${key}".`);
    }
  }
  const config: DeviceConfig = {
    ...(parsed as unknown as DeviceConfig),
  };
  // Optional fields of the wrong type are ignored rather than trusted or fatal.
  if (typeof parsed["activationKey"] !== "string") delete config.activationKey;
  if (typeof parsed["activationRequired"] !== "boolean") delete config.activationRequired;
  return config;
}

export function writeDeviceConfigFile(configPath: string, config: DeviceConfig): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const merged = { ...existing, ...config };
  const tmpPath = `${configPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), "utf-8");
  fs.renameSync(tmpPath, configPath);
}
