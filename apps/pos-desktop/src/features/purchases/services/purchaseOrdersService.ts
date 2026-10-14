import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `purchaseOrders` IPC namespace: arguments and results are forwarded untouched. */
export const purchaseOrdersService = {
  cancel: (...args: Parameters<PosApi["purchaseOrders"]["cancel"]>) => posApi().purchaseOrders.cancel(...args),
  create: (...args: Parameters<PosApi["purchaseOrders"]["create"]>) => posApi().purchaseOrders.create(...args),
  get: (...args: Parameters<PosApi["purchaseOrders"]["get"]>) => posApi().purchaseOrders.get(...args),
  list: (...args: Parameters<PosApi["purchaseOrders"]["list"]>) => posApi().purchaseOrders.list(...args),
  place: (...args: Parameters<PosApi["purchaseOrders"]["place"]>) => posApi().purchaseOrders.place(...args),
  receive: (...args: Parameters<PosApi["purchaseOrders"]["receive"]>) => posApi().purchaseOrders.receive(...args),
  update: (...args: Parameters<PosApi["purchaseOrders"]["update"]>) => posApi().purchaseOrders.update(...args),
};
