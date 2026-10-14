/**
 * Rolling up a bulk product's own stock with what's sitting in its pack sizes. packQty is "how
 * much of the parent's own uom one child unit represents", and a child's qtyOnHand is always a
 * count of whole packs (child uom is always "pcs") — so child.qtyOnHand × child.packQty is
 * already expressed in the parent's own uom, and adding it to the parent's own qty is a plain
 * sum, never a unit conversion.
 */

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Stock held in pack sizes, in the parent's own uom. This is the client-side twin of
 * @pos/database's `getPackStockByParent`, used where the full child list is already in hand
 * (e.g. PackSizesSection.tsx) rather than fetched store-wide — keep both in step. Every child
 * counts unconditionally: unlinked, inactive, and a negative qty (oversold packs) is summed
 * as-is, not clamped to 0.
 */
export function sumPackStock(children: ReadonlyArray<{ qtyOnHand: number; packQty: number }>): number {
  return round3(children.reduce((sum, c) => sum + c.qtyOnHand * c.packQty, 0));
}

/** A product's own qty plus whatever's in its pack sizes (0 when it has none). */
export function totalStockQty(ownQty: number, packStockQty: number | null): number {
  return round3(ownQty + (packStockQty ?? 0));
}

/** "30" or "30.5" — trims to 3 decimals, same rounding as every other quantity in the app. */
export function formatStockQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

/**
 * Loose stock plus each pack size on hand: "20 kg loose · 10 × Sugar 1kg · 4 × Sugar 500g".
 * Packs with nothing on hand are skipped; "no packs on hand" when every pack is at zero.
 */
export function formatPackBreakdown(
  ownQty: number,
  uom: string,
  packs: ReadonlyArray<{ name: string; qtyOnHand: number }>,
): string {
  const parts = [`${formatStockQty(ownQty)} ${uom} loose`];
  const onHand = packs.filter((p) => p.qtyOnHand > 0);
  if (onHand.length === 0) return `${parts[0]} · no packs on hand`;
  for (const p of onHand) parts.push(`${formatStockQty(p.qtyOnHand)} × ${p.name}`);
  return parts.join(" · ");
}

/**
 * A human-readable stock figure. For an ordinary product (packStockQty null), just its own
 * qty: "30 kg". For a bulk product with pack sizes, the total plus the loose/packed split:
 * "50 kg (30 kg loose + 20 kg in packs)".
 */
export function formatStockBreakdown(ownQty: number, packStockQty: number | null, uom: string): string {
  if (packStockQty === null) return `${formatStockQty(ownQty)} ${uom}`;
  const total = totalStockQty(ownQty, packStockQty);
  return `${formatStockQty(total)} ${uom} (${formatStockQty(ownQty)} ${uom} loose + ${formatStockQty(packStockQty)} ${uom} in packs)`;
}
