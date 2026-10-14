import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `labels` IPC namespace: arguments and results are forwarded untouched. */
export const labelsService = {
  getDefaults: (...args: Parameters<PosApi["labels"]["getDefaults"]>) => posApi().labels.getDefaults(...args),
  getSettings: (...args: Parameters<PosApi["labels"]["getSettings"]>) => posApi().labels.getSettings(...args),
  print: (...args: Parameters<PosApi["labels"]["print"]>) => posApi().labels.print(...args),
  setSettings: (...args: Parameters<PosApi["labels"]["setSettings"]>) => posApi().labels.setSettings(...args),
};
