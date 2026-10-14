import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `sales` IPC namespace: arguments and results are forwarded untouched. */
export const salesService = {
  listRecent: (...args: Parameters<PosApi["sales"]["listRecent"]>) => posApi().sales.listRecent(...args),
};
