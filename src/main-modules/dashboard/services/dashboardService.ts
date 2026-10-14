import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `dashboard` IPC namespace: arguments and results are forwarded untouched. */
export const dashboardService = {
  getSummary: (...args: Parameters<PosApi["dashboard"]["getSummary"]>) => posApi().dashboard.getSummary(...args),
};
