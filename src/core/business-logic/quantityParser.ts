export interface ParsedQuantity {
  productText: string;
  qty: number;
  /** Present when the input carried an explicit unit, e.g. "kg" in "arisi 5kg". */
  unit: string | null;
}

/**
 * Weight/volume uoms are sold off a scale or a jug, so a quantity against one of them is
 * naturally fractional (1.85 kg). Everything else ("pcs") is counted one at a time and has no
 * meaningful fraction — every qty input in the app rounds to a whole number unless its line's
 * uom passes this check.
 */
export function isFractionalUom(uom: string): boolean {
  return uom === "kg" || uom === "g" || uom === "l" || uom === "ml";
}

/** Rounds a typed qty to match what its uom allows: 2 decimal places if fractional, whole otherwise. */
export function roundQtyForUom(qty: number, uom: string): number {
  return isFractionalUom(uom) ? Math.round(qty * 100) / 100 : Math.round(qty);
}

const UNIT_ALTERNATION = "kg|g|l|ml|pcs|pkt|packet|packets|box|dozen";

type Matcher = (input: string) => ParsedQuantity | null;

function numberOrNull(text: string | undefined): number | null {
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const MATCHERS: Matcher[] = [
  // "2x milk", "2 x milk" — qty and 'x' separator, no unit
  (input) => {
    const match = input.match(/^(\d+(?:\.\d+)?)\s*x\s*(.+)$/i);
    if (!match) return null;
    const qty = numberOrNull(match[1]);
    const productText = match[2]?.trim() ?? "";
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: null };
  },
  // "milk x2", "milk x 2" — product then 'x' separator then qty, no unit
  (input) => {
    const match = input.match(/^(.+?)\s*x\s*(\d+(?:\.\d+)?)$/i);
    if (!match) return null;
    const productText = match[1]?.trim() ?? "";
    const qty = numberOrNull(match[2]);
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: null };
  },
  // "2kg rice", "1.85 kg tomato" — qty + explicit unit + product
  (input) => {
    const match = input.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\s+(.+)$`, "i"));
    if (!match) return null;
    const qty = numberOrNull(match[1]);
    const productText = match[3]?.trim() ?? "";
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: match[2]?.toLowerCase() ?? null };
  },
  // "rice 5kg", "tomato 1.85kg" — product + qty + explicit unit
  (input) => {
    const match = input.match(new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})$`, "i"));
    if (!match) return null;
    const productText = match[1]?.trim() ?? "";
    const qty = numberOrNull(match[2]);
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: match[3]?.toLowerCase() ?? null };
  },
  // "2 milk" — bare qty + product, no unit
  (input) => {
    const match = input.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!match) return null;
    const qty = numberOrNull(match[1]);
    const productText = match[2]?.trim() ?? "";
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: null };
  },
  // "milk 2" — product + bare qty, no unit
  (input) => {
    const match = input.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const productText = match[1]?.trim() ?? "";
    const qty = numberOrNull(match[2]);
    if (qty === null || productText.length === 0) return null;
    return { productText, qty, unit: null };
  },
];

/**
 * Parses cashier-friendly quantity shorthand ("2 milk", "milk 2", "2x milk", "milk x2",
 * "rice 5kg") into a product text fragment + quantity, per the documented quantity flow.
 * Falls back to qty=1 with the whole input as product text when nothing matches.
 */
export function parseQuantityInput(raw: string): ParsedQuantity {
  const input = raw.trim();
  if (input.length === 0) {
    return { productText: "", qty: 1, unit: null };
  }

  for (const matcher of MATCHERS) {
    const result = matcher(input);
    if (result) return result;
  }

  return { productText: input, qty: 1, unit: null };
}
