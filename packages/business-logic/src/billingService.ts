import type { Cart, CartLineTotal, CartTotals } from "@pos/types";

import { applyBillDiscount, applyLineDiscount } from "./discountEngine.js";
import { roundToNearestRupee } from "./money.js";
import { computeLineTax } from "./taxEngine.js";

export interface ComputeCartTotalsOptions {
  /** Cost price per unit, keyed by productId — used only for the below-cost discount guard. */
  costPricePaiseByProduct: Record<string, number>;
  /** Manager override: skip the below-cost guard entirely (must be audit-logged by the caller). */
  allowBelowCost: boolean;
}

export interface CartTotalsResult {
  lines: CartLineTotal[];
  totals: CartTotals;
}

/**
 * Pure function: cart in, totals out. No DB, no I/O. This is the single place bill math
 * happens so the billing screen, receipt printing, and any future report all agree.
 */
export function computeCartTotals(cart: Cart, options: ComputeCartTotalsOptions): CartTotalsResult {
  const lines: CartLineTotal[] = cart.lines.map((line) => {
    const costPricePaise = options.costPricePaiseByProduct[line.productId] ?? 0;

    const discount = applyLineDiscount({
      unitPricePaise: line.unitPricePaise,
      qty: line.qty,
      discountPercent: line.discountPercent,
      discountFlatPaise: line.discountFlatPaise,
      costPricePaise,
      allowBelowCost: options.allowBelowCost,
    });

    const tax = computeLineTax({
      netUnitPricePaise: discount.netUnitPricePaise,
      qty: line.qty,
      isTaxInclusive: line.isTaxInclusive,
      taxRatePercent: line.taxRatePercent,
    });

    return {
      ...line,
      grossPaise: discount.grossPaise,
      discountPaise: discount.discountPaise,
      taxablePaise: tax.taxablePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      totalPaise: tax.totalPaise,
    };
  });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.totalPaise, 0);
  const billDiscountPaise = applyBillDiscount({
    subtotalPaise,
    billDiscountPercent: cart.billDiscountPercent,
    billDiscountFlatPaise: cart.billDiscountFlatPaise,
  });

  const scale = subtotalPaise === 0 ? 1 : (subtotalPaise - billDiscountPaise) / subtotalPaise;

  let grossPaise = 0;
  let lineDiscountPaise = 0;
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let netBeforeRoundingPaise = 0;

  const scaledLines: CartLineTotal[] = lines.map((line) => {
    const scaledTaxable = Math.round(line.taxablePaise * scale);
    const scaledCgst = Math.round(line.cgstPaise * scale);
    const scaledSgst = Math.round(line.sgstPaise * scale);
    const scaledTotal = Math.round(line.totalPaise * scale);

    grossPaise += line.grossPaise;
    lineDiscountPaise += line.discountPaise;
    taxablePaise += scaledTaxable;
    cgstPaise += scaledCgst;
    sgstPaise += scaledSgst;
    netBeforeRoundingPaise += scaledTotal;

    return { ...line, taxablePaise: scaledTaxable, cgstPaise: scaledCgst, sgstPaise: scaledSgst, totalPaise: scaledTotal };
  });

  const { roundOffPaise, roundedPaise } = roundToNearestRupee(netBeforeRoundingPaise);

  const totals: CartTotals = {
    grossPaise,
    discountPaise: lineDiscountPaise + billDiscountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    roundOffPaise,
    netPaise: roundedPaise,
  };

  return { lines: scaledLines, totals };
}
