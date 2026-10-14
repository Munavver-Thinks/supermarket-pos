import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `activation` IPC namespace: arguments and results are forwarded untouched. */
export const activationService = {
  activate: (...args: Parameters<PosApi["activation"]["activate"]>) => posApi().activation.activate(...args),
};
