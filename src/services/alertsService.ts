import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `alerts` IPC namespace: arguments and results are forwarded untouched. */
export const alertsService = {
  list: (...args: Parameters<PosApi["alerts"]["list"]>) => posApi().alerts.list(...args),
};
