import path from "node:path";

import { app } from "electron";

export function getDbFilePath(): string {
  return path.join(app.getPath("userData"), "pos.db");
}

export function getDeviceConfigPath(): string {
  return path.join(app.getPath("userData"), "device-config.json");
}

export function getErrorLogDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function getBackupDir(): string {
  return path.join(app.getPath("userData"), "backups");
}
