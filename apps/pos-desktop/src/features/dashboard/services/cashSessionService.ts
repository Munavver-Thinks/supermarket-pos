import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `cashSession` IPC namespace: arguments and results are forwarded untouched. */
export const cashSessionService = {
  close: (...args: Parameters<PosApi["cashSession"]["close"]>) => posApi().cashSession.close(...args),
  open: (...args: Parameters<PosApi["cashSession"]["open"]>) => posApi().cashSession.open(...args),
  summary: (...args: Parameters<PosApi["cashSession"]["summary"]>) => posApi().cashSession.summary(...args),
};
