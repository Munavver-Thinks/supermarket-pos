import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `customers` IPC namespace: arguments and results are forwarded untouched. */
export const customersService = {
  create: (...args: Parameters<PosApi["customers"]["create"]>) => posApi().customers.create(...args),
  listRecent: (...args: Parameters<PosApi["customers"]["listRecent"]>) => posApi().customers.listRecent(...args),
  search: (...args: Parameters<PosApi["customers"]["search"]>) => posApi().customers.search(...args),
  update: (...args: Parameters<PosApi["customers"]["update"]>) => posApi().customers.update(...args),
};
