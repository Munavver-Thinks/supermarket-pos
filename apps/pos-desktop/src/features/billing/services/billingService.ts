import type { PosApi } from "@shared/ipc.js";

import { posApi } from "@/services/ipcClient.js";

/** Thin pass-through to the `billing` IPC namespace: arguments and results are forwarded untouched. */
export const billingService = {
  createSale: (...args: Parameters<PosApi["billing"]["createSale"]>) => posApi().billing.createSale(...args),
  deleteDraft: (...args: Parameters<PosApi["billing"]["deleteDraft"]>) => posApi().billing.deleteDraft(...args),
  getCustomer: (...args: Parameters<PosApi["billing"]["getCustomer"]>) => posApi().billing.getCustomer(...args),
  getMrpCaps: (...args: Parameters<PosApi["billing"]["getMrpCaps"]>) => posApi().billing.getMrpCaps(...args),
  listDrafts: (...args: Parameters<PosApi["billing"]["listDrafts"]>) => posApi().billing.listDrafts(...args),
  saveDraft: (...args: Parameters<PosApi["billing"]["saveDraft"]>) => posApi().billing.saveDraft(...args),
};
