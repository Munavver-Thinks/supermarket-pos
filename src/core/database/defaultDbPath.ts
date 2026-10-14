import os from "node:os";
import path from "node:path";

/** Must match `app.setName(...)` in electron/main/index.ts. */
const APP_NAME = "Supermarket POS";

/**
 * Resolves the same pos.db path the running Electron app uses (Electron's `userData`
 * directory) so the migrate/seed CLI scripts default to the real app database instead of
 * a decoy `./pos.db` in whatever directory `pnpm` happened to run from.
 */
export function defaultAppDbPath(): string {
  return path.join(electronUserDataDir(), "pos.db");
}

function electronUserDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "win32":
      return path.join(process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"), APP_NAME);
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_NAME);
    default:
      return path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(home, ".config"), APP_NAME);
  }
}
