/**
 * What happens when a bill asks for more of something than the shop's records say is on
 * the shelf.
 *
 * - allow: sell anyway, say nothing.
 * - warn:  sell anyway, but show the cashier the shortfall so the count gets fixed.
 * - block: refuse the sale until the stock is corrected.
 *
 * The default is warn. In a kirana the physical shelf is the truth and the database is
 * usually the one that's wrong — a missed purchase entry, a loose-weight item — so refusing
 * a customer standing at the counter would punish them for a bookkeeping gap. Block is
 * there for shops that keep tight counts and would rather stop than drift.
 */
export type NegativeStockPolicy = "allow" | "warn" | "block";

export const NEGATIVE_STOCK_POLICIES: NegativeStockPolicy[] = ["allow", "warn", "block"];

export const DEFAULT_NEGATIVE_STOCK_POLICY: NegativeStockPolicy = "warn";

/** The app_settings key the policy is stored under. */
export const NEGATIVE_STOCK_POLICY_KEY = "stock.negativePolicy";

/** Reads a stored value, falling back to the default for anything missing or unrecognised. */
export function parseNegativeStockPolicy(raw: string | undefined | null): NegativeStockPolicy {
  return NEGATIVE_STOCK_POLICIES.includes(raw as NegativeStockPolicy)
    ? (raw as NegativeStockPolicy)
    : DEFAULT_NEGATIVE_STOCK_POLICY;
}

export interface StockLineInput {
  productId: string;
  name: string;
  qty: number;
}

export interface StockShortfall {
  productId: string;
  name: string;
  requestedQty: number;
  onHandQty: number;
}

/**
 * Lines that ask for more than is on hand. Quantities are summed per product first — the
 * same item can sit on a bill twice (a restored draft, a second scan on its own line), and
 * two lines of 3 against a stock of 5 is a shortfall even though neither line is on its own.
 *
 * A product missing from `onHandByProduct` is treated as zero on hand.
 */
export function findStockShortfalls(
  lines: StockLineInput[],
  onHandByProduct: Record<string, number>,
): StockShortfall[] {
  const requested = new Map<string, StockShortfall>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const existing = requested.get(line.productId);
    if (existing) {
      existing.requestedQty += line.qty;
    } else {
      requested.set(line.productId, {
        productId: line.productId,
        name: line.name,
        requestedQty: line.qty,
        onHandQty: onHandByProduct[line.productId] ?? 0,
      });
    }
  }

  // A small tolerance, so 1.1 + 0.2 kg against 1.3 kg on hand isn't flagged by float drift.
  return [...requested.values()].filter((s) => s.requestedQty - s.onHandQty > 1e-9);
}

/** One sentence naming every short item, for the cashier. */
export function describeShortfalls(shortfalls: StockShortfall[]): string {
  const parts = shortfalls.map((s) => `${s.name} (asked ${roundQty(s.requestedQty)}, ${roundQty(s.onHandQty)} in stock)`);
  return `Not enough stock: ${parts.join("; ")}. Correct the stock in Inventory, or lower the quantity.`;
}

function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

export class InsufficientStockError extends Error {
  constructor(public readonly shortfalls: StockShortfall[]) {
    super(describeShortfalls(shortfalls));
    this.name = "InsufficientStockError";
  }
}
