import { readDeviceConfigFile, writeDeviceConfigFile, type DeviceConfig } from "./deviceConfigFile.js";
import { getDeviceConfigPath } from "./paths.js";

export type { DeviceConfig } from "./deviceConfigFile.js";

export function readDeviceConfig(): DeviceConfig | undefined {
  return readDeviceConfigFile(getDeviceConfigPath());
}

/** Atomic, and keeps fields it doesn't know about — see deviceConfigFile.ts. */
export function writeDeviceConfig(config: DeviceConfig): void {
  writeDeviceConfigFile(getDeviceConfigPath(), config);
}
