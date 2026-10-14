import { applyPercent, extractTaxableFromInclusive } from "./money.js";

export interface LineTaxInput {
  /** Unit price already net of any line discount, still tax-inclusive or -exclusive per the flag. */
  netUnitPricePaise: number;
  qty: number;
  isTaxInclusive: boolean;
  taxRatePercent: number;
}

export interface LineTaxResult {
  grossLinePaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
}

/**
 * Computes taxable value + CGST/SGST split for one bill line (intra-state only —
 * IGST/place-of-supply is out of Phase 1 scope, see plan). Tax-inclusive MRP is the
 * common Indian retail case: the printed unit price already contains tax, so the
 * taxable value is derived by dividing it back out.
 */
export function computeLineTax(input: LineTaxInput): LineTaxResult {
  const grossLinePaise = Math.round(input.netUnitPricePaise * input.qty);

  const taxablePaise = input.isTaxInclusive
    ? extractTaxableFromInclusive(grossLinePaise, input.taxRatePercent)
    : grossLinePaise;

  const totalTaxPaise = input.isTaxInclusive
    ? grossLinePaise - taxablePaise
    : applyPercent(taxablePaise, input.taxRatePercent);

  const cgstPaise = Math.round(totalTaxPaise / 2);
  const sgstPaise = totalTaxPaise - cgstPaise;

  const totalPaise = input.isTaxInclusive ? grossLinePaise : taxablePaise + totalTaxPaise;

  return { grossLinePaise, taxablePaise, cgstPaise, sgstPaise, totalPaise };
}
