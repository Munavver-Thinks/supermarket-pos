import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `suppliers` IPC namespace: arguments and results are forwarded untouched. */
export const suppliersService = {
  create: (...args: Parameters<PosApi["suppliers"]["create"]>) => posApi().suppliers.create(...args),
  list: (...args: Parameters<PosApi["suppliers"]["list"]>) => posApi().suppliers.list(...args),
  setActive: (...args: Parameters<PosApi["suppliers"]["setActive"]>) => posApi().suppliers.setActive(...args),
  update: (...args: Parameters<PosApi["suppliers"]["update"]>) => posApi().suppliers.update(...args),
};
