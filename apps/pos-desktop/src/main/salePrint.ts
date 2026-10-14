import { invoicesRepo, usersRepo, type Db } from "@pos/database";
import type { InvoiceData, ReceiptPrintFormat } from "@pos/types";

/**
 * The one path every receipt, A4 invoice and PDF of a saved bill goes through. It decides
 * "DUPLICATE COPY" from the print log (any copy after the first), not from the screen, and
 * records the print only once the printer or PDF writer says it worked.
 *
 * Kept free of electron so the rule is unit-tested; the caller supplies `output`, which does
 * the actual printing and never throws.
 */

export interface SalePrintOutput {
  ok: boolean;
  error?: string;
  /** Where a PDF was saved. */
  path?: string;
}

export interface SalePrintResult extends SalePrintOutput {
  duplicate?: boolean;
}

/** A bill number such as "POS-20261005-42" made safe as a file name. */
export function pdfFileName(billNo: string): string {
  const cleaned = billNo.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${cleaned || "invoice"}.pdf`;
}

export async function printSaleDocument(
  db: Db,
  input: {
    storeId: string;
    deviceId: string | null;
    saleId: string;
    actingUserId: string;
    format: ReceiptPrintFormat;
  },
  output: (data: InvoiceData, duplicate: boolean) => Promise<SalePrintOutput>,
  onLogError: (error: unknown) => void,
): Promise<SalePrintResult> {
  const actor = await usersRepo.getById(db, input.actingUserId);
  if (!actor || !actor.isActive || actor.storeId !== input.storeId) {
    return { ok: false, error: "You are not signed in to this store." };
  }

  const data = await invoicesRepo.getInvoiceData(db, input.saleId);
  if (!data || data.sale.storeId !== input.storeId) {
    return { ok: false, error: "That bill could not be found." };
  }

  const duplicate = await invoicesRepo.hasBeenPrinted(db, input.saleId);

  let result: SalePrintOutput;
  try {
    result = await output(data, duplicate);
  } catch (error) {
    // Printing is hardware; a failure is reported to the counter, never thrown at it.
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) return { ...result, duplicate };

  try {
    await invoicesRepo.logSuccessfulPrint(db, {
      storeId: input.storeId,
      saleId: input.saleId,
      billNo: data.sale.billNo,
      format: input.format,
      userId: actor.id,
      deviceId: input.deviceId,
      duplicate,
    });
  } catch (error) {
    // The paper is already out; say so rather than report a failed print. The error is logged.
    onLogError(error);
  }
  return { ...result, duplicate };
}
