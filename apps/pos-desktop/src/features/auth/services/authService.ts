import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `auth` IPC namespace: arguments and results are forwarded untouched. */
export const authService = {
  login: (...args: Parameters<PosApi["auth"]["login"]>) => posApi().auth.login(...args),
};
