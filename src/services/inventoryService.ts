import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `inventory` IPC namespace: arguments and results are forwarded untouched. */
export const inventoryService = {
  adjustStock: (...args: Parameters<PosApi["inventory"]["adjustStock"]>) => posApi().inventory.adjustStock(...args),
  getLowStock: (...args: Parameters<PosApi["inventory"]["getLowStock"]>) => posApi().inventory.getLowStock(...args),
  getStockLevels: (...args: Parameters<PosApi["inventory"]["getStockLevels"]>) => posApi().inventory.getStockLevels(...args),
  repack: (...args: Parameters<PosApi["inventory"]["repack"]>) => posApi().inventory.repack(...args),
  repackHistory: (...args: Parameters<PosApi["inventory"]["repackHistory"]>) => posApi().inventory.repackHistory(...args),
};
