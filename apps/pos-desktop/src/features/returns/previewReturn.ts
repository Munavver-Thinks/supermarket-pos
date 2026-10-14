import { computeReturnTotals, ReturnQuantityError, roundQtyForUom } from "@pos/business-logic";
import type { ReturnableSale } from "@pos/types";

import type { ReturnPreview } from "./types.js";

/**
 * The same preview math the Returns screen has always shown, and that an exchange's picker
 * on the Billing screen now shows too: parses the typed quantities, runs them through the
 * real return engine (so the number on screen is the number that would actually be charged),
 * and reports back what's selected, what it refunds, and any quantity error to show instead.
 */
export function previewReturn(sale: ReturnableSale, qtys: Record<string, string>): ReturnPreview {
  const selected = sale.lines
    .map((line) => ({ line, qty: roundQtyForUom(Number(qtys[line.saleItemId]) || 0, line.uom) }))
    .filter((s) => s.qty > 0);

  let refundPaise = 0;
  let previewError: string | null = null;
  if (selected.length > 0) {
    try {
      refundPaise = computeReturnTotals(
        selected.map(({ line, qty }) => ({
          saleItemId: line.saleItemId,
          productId: line.productId,
          soldQty: line.soldQty,
          alreadyReturnedQty: line.alreadyReturnedQty,
          returnQty: qty,
          discountPaise: line.discountPaise,
          taxablePaise: line.taxablePaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          lineTotalPaise: line.lineTotalPaise,
        })),
      ).totals.refundPaise;
    } catch (error) {
      previewError = error instanceof ReturnQuantityError ? error.message : "Check the quantities.";
    }
  }

  return { selected, refundPaise, previewError };
}
