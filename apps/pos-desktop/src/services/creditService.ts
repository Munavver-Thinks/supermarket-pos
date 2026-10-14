import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `credit` IPC namespace: arguments and results are forwarded untouched. */
export const creditService = {
  getBalance: (...args: Parameters<PosApi["credit"]["getBalance"]>) => posApi().credit.getBalance(...args),
  listEntries: (...args: Parameters<PosApi["credit"]["listEntries"]>) => posApi().credit.listEntries(...args),
  listOutstanding: (...args: Parameters<PosApi["credit"]["listOutstanding"]>) => posApi().credit.listOutstanding(...args),
  recordRepayment: (...args: Parameters<PosApi["credit"]["recordRepayment"]>) => posApi().credit.recordRepayment(...args),
  setLimit: (...args: Parameters<PosApi["credit"]["setLimit"]>) => posApi().credit.setLimit(...args),
};
