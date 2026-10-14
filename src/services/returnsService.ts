import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `returns` IPC namespace: arguments and results are forwarded untouched. */
export const returnsService = {
  create: (...args: Parameters<PosApi["returns"]["create"]>) => posApi().returns.create(...args),
  listRecent: (...args: Parameters<PosApi["returns"]["listRecent"]>) => posApi().returns.listRecent(...args),
  lookup: (...args: Parameters<PosApi["returns"]["lookup"]>) => posApi().returns.lookup(...args),
};
