import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `users` IPC namespace: arguments and results are forwarded untouched. */
export const usersService = {
  changeOwnPassword: (...args: Parameters<PosApi["users"]["changeOwnPassword"]>) => posApi().users.changeOwnPassword(...args),
  create: (...args: Parameters<PosApi["users"]["create"]>) => posApi().users.create(...args),
  listByStore: (...args: Parameters<PosApi["users"]["listByStore"]>) => posApi().users.listByStore(...args),
  resetPassword: (...args: Parameters<PosApi["users"]["resetPassword"]>) => posApi().users.resetPassword(...args),
  setActive: (...args: Parameters<PosApi["users"]["setActive"]>) => posApi().users.setActive(...args),
  update: (...args: Parameters<PosApi["users"]["update"]>) => posApi().users.update(...args),
};
