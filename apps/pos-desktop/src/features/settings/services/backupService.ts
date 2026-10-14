import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `backup` IPC namespace: arguments and results are forwarded untouched. */
export const backupService = {
  list: (...args: Parameters<PosApi["backup"]["list"]>) => posApi().backup.list(...args),
  restore: (...args: Parameters<PosApi["backup"]["restore"]>) => posApi().backup.restore(...args),
  run: (...args: Parameters<PosApi["backup"]["run"]>) => posApi().backup.run(...args),
};
