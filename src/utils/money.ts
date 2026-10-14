import { rupeesToPaise } from "@pos/business-logic";

/*
 * Rupee text-box input to integer paise. The forms have always parsed in four slightly
 * different ways, and each way is kept as its own helper so no screen changes behavior:
 * what an empty or invalid box turns into (0, NaN or null) decides whether a save is
 * rejected or silently written as zero.
 */

/** Empty or invalid input counts as 0 — payments, repayments, opening cash, credit limits. */
export function parseRupeesOrZero(text: string): number {
  return rupeesToPaise(Number(text) || 0);
}

/** Invalid input stays NaN so the screen's own validation rejects it — prices, MRP, cost. */
export function parseRupeesStrict(text: string): number {
  return rupeesToPaise(Number(text));
}

/** Null when the box is empty, not a number, or negative; 0 is a valid amount. */
export function parseNonNegativeRupees(text: string): number | null {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < 0) return null;
  return rupeesToPaise(value);
}

/** Null for empty, invalid or zero — "box left empty / no change", never a real MRP of 0. */
export function parsePositiveRupeesOrNull(text: string): number | null {
  const paise = parseRupeesStrict(text);
  return paise > 0 ? paise : null;
}
