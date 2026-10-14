import type { CartLine } from "@pos/types";

import { formatIndianCurrency } from "./money.js";

export interface MrpLoweredLine {
  name: string;
  fromPaise: number;
  toPaise: number;
}

/**
 * Caps each line's unit price at the MRP recorded for the stock it would actually draw from,
 * when one is known for that product. Applies uniformly whether the line's price came from
 * the sale or wholesale rate, since that's already baked into unitPricePaise by the time this
 * runs. Never raises a price — a line with no cap, or already at or below its cap, is left
 * untouched (the same object, not a copy).
 */
export function capLinesAtMrp(
  lines: CartLine[],
  caps: Record<string, number>,
): { lines: CartLine[]; lowered: MrpLoweredLine[] } {
  const lowered: MrpLoweredLine[] = [];
  const newLines = lines.map((line) => {
    const cap = caps[line.productId];
    if (cap === undefined || line.unitPricePaise <= cap) return line;
    lowered.push({ name: line.name, fromPaise: line.unitPricePaise, toPaise: cap });
    return { ...line, unitPricePaise: cap };
  });
  return { lines: newLines, lowered };
}

/** Status text for the billing screen after a background check quietly lowered a price. */
export function mrpLoweredText(lowered: MrpLoweredLine[]): string {
  const items = lowered
    .map((l) => `${l.name} ${formatIndianCurrency(l.fromPaise)} → ${formatIndianCurrency(l.toPaise)}`)
    .join(", ");
  return `Price lowered to the printed MRP: ${items}.`;
}

/** Error text for a sale the server refused because a line priced above its MRP cap. */
export function mrpRefusalText(lowered: MrpLoweredLine[]): string {
  const items = lowered
    .map((l) => `${l.name} ${formatIndianCurrency(l.fromPaise)} → ${formatIndianCurrency(l.toPaise)}`)
    .join(", ");
  return (
    `Price is above the printed MRP of the stock being sold: ${items}. ` +
    "The bill has been corrected — check the new total and take payment again."
  );
}

export type MrpWarningKind = "sale" | "wholesale";

export interface MrpWarning {
  kind: MrpWarningKind;
  message: string;
}

/**
 * Soft warning (never a hard block) for a new MRP that is below what a product already sells
 * for: a `sale` warning when it undercuts the sale price, separately a `wholesale` warning
 * when a wholesale rate is set and undercut too. mrpPaise <= 0 ("no MRP") never warns.
 */
export function findMrpWarnings(input: {
  mrpPaise: number;
  salePricePaise: number;
  wholesalePricePaise: number | null;
}): MrpWarning[] {
  const { mrpPaise, salePricePaise, wholesalePricePaise } = input;
  if (mrpPaise <= 0) return [];

  const warnings: MrpWarning[] = [];

  if (salePricePaise > mrpPaise) {
    warnings.push({
      kind: "sale",
      message: `MRP ${formatIndianCurrency(mrpPaise)} is below the selling price ${formatIndianCurrency(salePricePaise)} — the selling price will be lowered to ${formatIndianCurrency(mrpPaise)}.`,
    });
  }

  if (wholesalePricePaise != null && wholesalePricePaise > mrpPaise) {
    warnings.push({
      kind: "wholesale",
      message: `MRP ${formatIndianCurrency(mrpPaise)} is below the wholesale price ${formatIndianCurrency(wholesalePricePaise)} — the wholesale price will be lowered to ${formatIndianCurrency(mrpPaise)}.`,
    });
  }

  return warnings;
}

/** Confirm-on-receive text for the purchase screens, listing every line whose new MRP undercuts its sale price. */
export function purchaseMrpConfirmText(rows: Array<{ name: string; mrpPaise: number; salePricePaise: number }>): string {
  const lines = rows.map(
    (r) => `• ${r.name} — MRP ${formatIndianCurrency(r.mrpPaise)}, sells at ${formatIndianCurrency(r.salePricePaise)}`,
  );
  return `These items' new MRP is below what they sell for:\n${lines.join("\n")}\n\nReceive anyway? Their selling price will be lowered to the new MRP.`;
}
