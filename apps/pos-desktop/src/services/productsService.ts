import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `products` IPC namespace: arguments and results are forwarded untouched. */
export const productsService = {
  changePrices: (...args: Parameters<PosApi["products"]["changePrices"]>) => posApi().products.changePrices(...args),
  create: (...args: Parameters<PosApi["products"]["create"]>) => posApi().products.create(...args),
  createChild: (...args: Parameters<PosApi["products"]["createChild"]>) => posApi().products.createChild(...args),
  get: (...args: Parameters<PosApi["products"]["get"]>) => posApi().products.get(...args),
  listAdmin: (...args: Parameters<PosApi["products"]["listAdmin"]>) => posApi().products.listAdmin(...args),
  listChildren: (...args: Parameters<PosApi["products"]["listChildren"]>) => posApi().products.listChildren(...args),
  relinkChildPrice: (...args: Parameters<PosApi["products"]["relinkChildPrice"]>) => posApi().products.relinkChildPrice(...args),
  search: (...args: Parameters<PosApi["products"]["search"]>) => posApi().products.search(...args),
  setActive: (...args: Parameters<PosApi["products"]["setActive"]>) => posApi().products.setActive(...args),
  update: (...args: Parameters<PosApi["products"]["update"]>) => posApi().products.update(...args),
};
