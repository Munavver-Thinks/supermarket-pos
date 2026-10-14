/**
 * All money math lives here. Everywhere else in the codebase treats money as an
 * opaque integer number of paise — never a float, never divided without going through
 * one of these functions, so rounding behavior is defined in exactly one place.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Splits a whole-percent-or-fractional discount off a base amount, rounded to the nearest paisa. */
export function applyPercent(basePaise: number, percent: number): number {
  return Math.round((basePaise * percent) / 100);
}

/**
 * Given a tax-inclusive amount and a tax rate, returns the taxable (pre-tax) value.
 * taxable = inclusive / (1 + rate/100), rounded to the nearest paisa.
 */
export function extractTaxableFromInclusive(inclusivePaise: number, taxRatePercent: number): number {
  if (taxRatePercent === 0) return inclusivePaise;
  return Math.round((inclusivePaise * 100) / (100 + taxRatePercent));
}

/** Rounds the final bill total to the nearest rupee and returns { roundOffPaise, roundedPaise }. */
export function roundToNearestRupee(paise: number): { roundOffPaise: number; roundedPaise: number } {
  const roundedPaise = Math.round(paise / 100) * 100;
  return { roundOffPaise: roundedPaise - paise, roundedPaise };
}

const INDIAN_GROUPING = /(\d)(?=(\d\d)+\d$)/g;

/** Formats paise as an Indian-grouped rupee string, e.g. 12345675 -> "1,23,456.75". */
export function formatIndianCurrency(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  const rupeesStr = String(rupees).replace(INDIAN_GROUPING, "$1,");
  return `${negative ? "-" : ""}₹${rupeesStr}.${fraction}`;
}
