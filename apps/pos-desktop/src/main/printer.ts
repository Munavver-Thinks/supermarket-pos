import { BrowserWindow } from "electron";
import {
  buildReceiptHtml,
  type ReceiptData,
  type ReceiptHtmlOptions,
  type ReceiptLanguage,
} from "@pos/business-logic";

export type { ReceiptData } from "@pos/business-logic";

export interface PrintResult {
  ok: boolean;
  error?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Renders the receipt as an HTML page and sends it through Electron's normal print
 * pipeline (any Windows-driver-backed printer, including most thermal printers).
 * This deliberately avoids a native ESC/POS byte-protocol addon: that would need the
 * same C++ compiler toolchain this machine doesn't have.
 *
 * Tamil works through this path without a hand-built bitmap: Chromium shapes the Tamil
 * text with a Windows font that has Tamil glyphs (Nirmala UI / Latha) and the driver
 * receives rendered output, so the printer never needs a Tamil code page. The page itself
 * — language setting, font stack, wrapping for 58mm/80mm rolls, escaping — is built by
 * `buildReceiptHtml` in @pos/business-logic, where it is unit-tested.
 *
 * Per Rule 7 ("hardware failures must not crash the POS"): this function never throws.
 * A print failure is reported back to the caller so the bill still completes and the
 * cashier can retry or reprint.
 */
export async function printReceipt(
  data: ReceiptData,
  language: ReceiptLanguage,
  printerName?: string,
  options: ReceiptHtmlOptions = {},
): Promise<PrintResult> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });

  try {
    const html = buildReceiptHtml(data, language, options);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const ok = await new Promise<boolean>((resolve) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: false,
          margins: { marginType: "none" },
          ...(printerName ? { deviceName: printerName } : {}),
        },
        (success) => resolve(success),
      );
    });

    return ok ? { ok: true } : { ok: false, error: "Printer reported failure or is unavailable" };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    win.destroy();
  }
}

/**
 * Prints a full page (the A4 invoice) through the system print dialog, so the cashier picks
 * an A4 printer rather than the receipt roll the silent path would use. Never throws; a
 * cancelled dialog comes back as not ok.
 */
export async function printHtmlWithDialog(html: string): Promise<PrintResult> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const outcome = await new Promise<{ success: boolean; reason: string }>((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) =>
        resolve({ success, reason: failureReason }),
      );
    });
    if (outcome.success) return { ok: true };
    return {
      ok: false,
      error: outcome.reason === "cancelled" ? "Printing was cancelled." : `Could not print: ${outcome.reason}`,
    };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    win.destroy();
  }
}

/**
 * Prints a sheet of shelf labels, one row of labels per page. With a label printer chosen it
 * prints silently to that printer — labels must never come out of the receipt roll, which is
 * what an unnamed silent print would use. With none chosen it opens the system print window
 * so the person picks one. Never throws; a cancelled window comes back as not ok.
 */
export async function printLabels(
  html: string,
  options: { printerName: string | null; widthMm: number; heightMm: number },
): Promise<PrintResult> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const outcome = await new Promise<{ success: boolean; reason: string }>((resolve) => {
      win.webContents.print(
        {
          silent: options.printerName !== null,
          printBackground: true,
          margins: { marginType: "none" },
          // Electron wants microns.
          pageSize: { width: Math.round(options.widthMm * 1000), height: Math.round(options.heightMm * 1000) },
          ...(options.printerName ? { deviceName: options.printerName } : {}),
        },
        (success, failureReason) => resolve({ success, reason: failureReason }),
      );
    });
    if (outcome.success) return { ok: true };
    return {
      ok: false,
      error: outcome.reason === "cancelled" ? "Printing was cancelled." : `Could not print: ${outcome.reason}`,
    };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    win.destroy();
  }
}

/** Renders a page to an A4 PDF in a hidden window. Never throws. */
export async function saveHtmlAsPdf(html: string): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string }> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
    return { ok: true, pdf };
  } catch (error) {
    return { ok: false, error: `Could not create the PDF: ${errorText(error)}` };
  } finally {
    win.destroy();
  }
}

export async function listPrinters(): Promise<string[]> {
  const win = new BrowserWindow({ show: false });
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => p.name);
  } finally {
    win.destroy();
  }
}
