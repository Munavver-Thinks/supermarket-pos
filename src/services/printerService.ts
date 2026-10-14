import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `printer` IPC namespace: arguments and results are forwarded untouched. */
export const printerService = {
  listPrinters: (...args: Parameters<PosApi["printer"]["listPrinters"]>) => posApi().printer.listPrinters(...args),
  printInvoiceA4: (...args: Parameters<PosApi["printer"]["printInvoiceA4"]>) => posApi().printer.printInvoiceA4(...args),
  printReceipt: (...args: Parameters<PosApi["printer"]["printReceipt"]>) => posApi().printer.printReceipt(...args),
  saveInvoicePdf: (...args: Parameters<PosApi["printer"]["saveInvoicePdf"]>) => posApi().printer.saveInvoicePdf(...args),
};
