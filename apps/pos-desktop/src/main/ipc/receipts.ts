import fs from "node:fs/promises";

import { buildA4InvoiceHtml, parseReceiptLanguage, RECEIPT_LANGUAGE_KEY } from "@pos/business-logic";
import { salesRepo, settingsRepo, type Db } from "@pos/database";
import { dialog, ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { reportError } from "../errorReporting.js";
import { printHtmlWithDialog, printReceipt, saveHtmlAsPdf } from "../printer.js";
import { pdfFileName, printSaleDocument, type SalePrintResult } from "../salePrint.js";

import { safeHandle, type HandlerContext } from "./common.js";

const idSchema = z.string().uuid();

function logPrintError(ctx: HandlerContext, userId: string, context: string): (error: unknown) => void {
  return (error) => reportError(ctx.getDb(), { storeId: ctx.deviceConfig.storeId, userId, context }, error);
}


/**
 * The 80 mm receipt, used both right after a sale and for a reprint from Sales. Whether it is
 * stamped "DUPLICATE COPY" is decided from the print log, so the first copy after a sale is
 * the original and every other one is marked.
 */
export async function printSaleReceipt(
  db: Db,
  ctx: HandlerContext,
  rawSaleId: unknown,
  rawActingUserId: unknown,
): Promise<SalePrintResult> {
  const saleId = idSchema.parse(rawSaleId);
  const actingUserId = idSchema.parse(rawActingUserId);
  const language = parseReceiptLanguage(await settingsRepo.getSetting(db, RECEIPT_LANGUAGE_KEY));

  return printSaleDocument(
    db,
    { storeId: ctx.deviceConfig.storeId, deviceId: ctx.deviceConfig.deviceId, saleId, actingUserId, format: "receipt" },
    async (data, duplicate) => {
      const withItems = await salesRepo.getSaleWithItems(db, saleId);
      if (!withItems) return { ok: false, error: "That bill could not be found." };
      const cashLeg = data.payments.find((p) => p.mode === "cash" && p.tenderedPaise != null);
      return printReceipt(
        {
          storeName: data.store.name,
          storeAddress: data.store.address,
          storeGstin: data.store.gstin,
          sale: withItems.sale,
          items: withItems.items,
          exchangeReturn: data.exchangeReturn ?? null,
          cashTender: cashLeg
            ? {
                tenderedPaise: cashLeg.tenderedPaise!,
                changePaise: cashLeg.tenderedPaise! - cashLeg.amountPaise,
                changeAction: cashLeg.changeAction ?? "handback",
              }
            : null,
        },
        language,
        undefined,
        { duplicate },
      );
    },
    logPrintError(ctx, actingUserId, IPC_CHANNELS.printerPrintReceipt),
  );
}

export function registerReceiptHandlers(ctx: HandlerContext): void {
  ipcMain.handle(
    IPC_CHANNELS.printerPrintInvoiceA4,
    safeHandle(ctx, IPC_CHANNELS.printerPrintInvoiceA4, async (db, rawSaleId: unknown, rawActingUserId: unknown) => {
      const saleId = idSchema.parse(rawSaleId);
      const actingUserId = idSchema.parse(rawActingUserId);
      const language = parseReceiptLanguage(await settingsRepo.getSetting(db, RECEIPT_LANGUAGE_KEY));
      return printSaleDocument(
        db,
        { storeId: ctx.deviceConfig.storeId, deviceId: ctx.deviceConfig.deviceId, saleId, actingUserId, format: "a4" },
        (data, duplicate) => printHtmlWithDialog(buildA4InvoiceHtml(data, language, { duplicate })),
        logPrintError(ctx, actingUserId, IPC_CHANNELS.printerPrintInvoiceA4),
      );
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.printerSaveInvoicePdf,
    safeHandle(ctx, IPC_CHANNELS.printerSaveInvoicePdf, async (db, rawSaleId: unknown, rawActingUserId: unknown) => {
      const saleId = idSchema.parse(rawSaleId);
      const actingUserId = idSchema.parse(rawActingUserId);
      const language = parseReceiptLanguage(await settingsRepo.getSetting(db, RECEIPT_LANGUAGE_KEY));
      return printSaleDocument(
        db,
        { storeId: ctx.deviceConfig.storeId, deviceId: ctx.deviceConfig.deviceId, saleId, actingUserId, format: "pdf" },
        async (data, duplicate) => {
          // The dialog decides where the file lands; the renderer never names a path.
          const choice = await dialog.showSaveDialog({
            title: "Save invoice as PDF",
            defaultPath: pdfFileName(data.sale.billNo),
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (choice.canceled || !choice.filePath) return { ok: false, error: "Save cancelled." };

          const rendered = await saveHtmlAsPdf(buildA4InvoiceHtml(data, language, { duplicate }));
          if (!rendered.ok) return { ok: false, error: rendered.error };
          try {
            await fs.writeFile(choice.filePath, rendered.pdf);
          } catch (error) {
            return { ok: false, error: `Could not write the file: ${error instanceof Error ? error.message : String(error)}` };
          }
          return { ok: true, path: choice.filePath };
        },
        logPrintError(ctx, actingUserId, IPC_CHANNELS.printerSaveInvoicePdf),
      );
    }),
  );
}
