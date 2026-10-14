import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `reports` IPC namespace: arguments and results are forwarded untouched. */
export const reportsService = {
  deadStock: (...args: Parameters<PosApi["reports"]["deadStock"]>) => posApi().reports.deadStock(...args),
  expiry: (...args: Parameters<PosApi["reports"]["expiry"]>) => posApi().reports.expiry(...args),
  exportCsv: (...args: Parameters<PosApi["reports"]["exportCsv"]>) => posApi().reports.exportCsv(...args),
  gst: (...args: Parameters<PosApi["reports"]["gst"]>) => posApi().reports.gst(...args),
  hsn: (...args: Parameters<PosApi["reports"]["hsn"]>) => posApi().reports.hsn(...args),
  margins: (...args: Parameters<PosApi["reports"]["margins"]>) => posApi().reports.margins(...args),
  profit: (...args: Parameters<PosApi["reports"]["profit"]>) => posApi().reports.profit(...args),
  sales: (...args: Parameters<PosApi["reports"]["sales"]>) => posApi().reports.sales(...args),
  slowMoving: (...args: Parameters<PosApi["reports"]["slowMoving"]>) => posApi().reports.slowMoving(...args),
  stockValuation: (...args: Parameters<PosApi["reports"]["stockValuation"]>) => posApi().reports.stockValuation(...args),
  topProducts: (...args: Parameters<PosApi["reports"]["topProducts"]>) => posApi().reports.topProducts(...args),
};
