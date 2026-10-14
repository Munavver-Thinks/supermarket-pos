import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `storeSettings` IPC namespace: arguments and results are forwarded untouched. */
export const storeSettingsService = {
  getBlockExpiredSale: (...args: Parameters<PosApi["storeSettings"]["getBlockExpiredSale"]>) => posApi().storeSettings.getBlockExpiredSale(...args),
  getNegativeStockPolicy: (...args: Parameters<PosApi["storeSettings"]["getNegativeStockPolicy"]>) => posApi().storeSettings.getNegativeStockPolicy(...args),
  getReceiptLanguage: (...args: Parameters<PosApi["storeSettings"]["getReceiptLanguage"]>) => posApi().storeSettings.getReceiptLanguage(...args),
  setBlockExpiredSale: (...args: Parameters<PosApi["storeSettings"]["setBlockExpiredSale"]>) => posApi().storeSettings.setBlockExpiredSale(...args),
  setNegativeStockPolicy: (...args: Parameters<PosApi["storeSettings"]["setNegativeStockPolicy"]>) => posApi().storeSettings.setNegativeStockPolicy(...args),
  setReceiptLanguage: (...args: Parameters<PosApi["storeSettings"]["setReceiptLanguage"]>) => posApi().storeSettings.setReceiptLanguage(...args),
};
