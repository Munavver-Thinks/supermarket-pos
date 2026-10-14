import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `audit` IPC namespace: arguments and results are forwarded untouched. */
export const auditService = {
  list: (...args: Parameters<PosApi["audit"]["list"]>) => posApi().audit.list(...args),
};
