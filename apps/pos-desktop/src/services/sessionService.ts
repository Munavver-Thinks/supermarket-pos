import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `session` IPC namespace: arguments and results are forwarded untouched. */
export const sessionService = {
  getContext: (...args: Parameters<PosApi["session"]["getContext"]>) => posApi().session.getContext(...args),
};
