import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `batches` IPC namespace: arguments and results are forwarded untouched. */
export const batchesService = {
  listExpiring: (...args: Parameters<PosApi["batches"]["listExpiring"]>) => posApi().batches.listExpiring(...args),
  writeOff: (...args: Parameters<PosApi["batches"]["writeOff"]>) => posApi().batches.writeOff(...args),
};
