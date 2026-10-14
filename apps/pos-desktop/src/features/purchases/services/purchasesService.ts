import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `purchases` IPC namespace: arguments and results are forwarded untouched. */
export const purchasesService = {
  create: (...args: Parameters<PosApi["purchases"]["create"]>) => posApi().purchases.create(...args),
  getPriceSnapshots: (...args: Parameters<PosApi["purchases"]["getPriceSnapshots"]>) => posApi().purchases.getPriceSnapshots(...args),
  listRecent: (...args: Parameters<PosApi["purchases"]["listRecent"]>) => posApi().purchases.listRecent(...args),
};
