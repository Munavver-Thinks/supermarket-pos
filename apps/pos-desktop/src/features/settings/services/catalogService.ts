import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `catalog` IPC namespace: arguments and results are forwarded untouched. */
export const catalogService = {
  seedDemo: (...args: Parameters<PosApi["catalog"]["seedDemo"]>) => posApi().catalog.seedDemo(...args),
};
