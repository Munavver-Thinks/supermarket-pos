import type { Cart, CartLine } from "@pos/types";

/**
 * Working with several open bills at the counter: copy one, fold one into another, or move
 * part of a bill onto a new one (a customer who wants two bills, or a second person paying
 * for their share). Pure, with ids passed in, so every rule is testable.
 *
 * Every result is a fresh cart. A copy or a split always gets a new clientTxnId — the id is
 * the sale's idempotency key, and two carts sharing one would make the second payment
 * silently return the first bill.
 */

/** Same tolerance as the stock check, so 0.1 + 0.2 kg reads as 0.3. */
const QTY_EPSILON = 1e-9;

/** Weighed quantities are floats; keep them to 3 places so a split never leaves 0.30000000000000004. */
function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

export type BillTabResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** A copy of a bill as a new, unpaid bill: same lines and discounts, no customer. */
export function duplicateCart(cart: Cart, newId: () => string): Cart {
  return {
    ...cart,
    clientTxnId: newId(),
    customerId: null,
    heldAt: null,
    lines: cart.lines.map((line) => ({ ...line, lineId: newId() })),
  };
}

function sameLineTerms(a: CartLine, b: CartLine): boolean {
  return (
    a.productId === b.productId &&
    a.unitPricePaise === b.unitPricePaise &&
    a.discountPercent === b.discountPercent &&
    a.discountFlatPaise === b.discountFlatPaise &&
    a.isTaxInclusive === b.isTaxInclusive &&
    a.taxRatePercent === b.taxRatePercent
  );
}

/**
 * Adds `source`'s lines onto `target`. A line for the same product at the same price and
 * discount adds to the quantity already there; anything else is appended. The target keeps
 * its id, so it stays the bill that gets paid.
 *
 * Refused when the two bills belong to different customers (the khata would be ambiguous),
 * or when the source has a discount on the whole bill (it can't be carried over honestly —
 * it was given against that bill's total).
 */
export function mergeCarts(
  target: Cart,
  source: Cart,
  newId: () => string,
  sourceLabel = "that bill",
): BillTabResult<{ cart: Cart }> {
  if (target.clientTxnId === source.clientTxnId) {
    return { ok: false, error: "Choose a different bill to merge into." };
  }
  if (target.customerId && source.customerId && target.customerId !== source.customerId) {
    return { ok: false, error: "These bills are for different customers, so they can't be merged." };
  }
  if (source.billDiscountPercent > 0 || source.billDiscountFlatPaise > 0) {
    return { ok: false, error: `Clear the discount on ${sourceLabel} first.` };
  }
  if (source.lines.length === 0) {
    return { ok: false, error: `${sourceLabel} has no items to merge.` };
  }

  const lines = target.lines.map((line) => ({ ...line }));
  for (const incoming of source.lines) {
    const match = lines.find((line) => sameLineTerms(line, incoming));
    if (match) {
      match.qty = roundQty(match.qty + incoming.qty);
    } else {
      lines.push({ ...incoming, lineId: newId() });
    }
  }

  return {
    ok: true,
    cart: { ...target, customerId: target.customerId ?? source.customerId, lines },
  };
}

/**
 * Moves the chosen quantities (by line id) onto a new bill. Loose items may be split by
 * weight. A line moved in full leaves the original bill; the original keeps its id, its
 * customer and any whole-bill discount. The new bill keeps the customer but starts with no
 * whole-bill discount.
 */
export function splitCart(
  cart: Cart,
  take: Record<string, number>,
  newId: () => string,
): BillTabResult<{ remaining: Cart; split: Cart }> {
  const byId = new Map(cart.lines.map((line) => [line.lineId, line]));
  const chosen = Object.entries(take).filter(([, qty]) => Number.isFinite(qty) && qty > QTY_EPSILON);

  if (chosen.length === 0) {
    return { ok: false, error: "Choose at least one item to move to the new bill." };
  }

  const moving = new Map<string, number>();
  for (const [lineId, qty] of chosen) {
    const line = byId.get(lineId);
    if (!line) return { ok: false, error: "That item is no longer on this bill." };
    if (qty - line.qty > QTY_EPSILON) {
      return { ok: false, error: `${line.name}: only ${roundQty(line.qty)} ${line.uom} on the bill.` };
    }
    moving.set(lineId, qty);
  }

  const remainingLines: CartLine[] = [];
  const splitLines: CartLine[] = [];
  for (const line of cart.lines) {
    const moved = moving.get(line.lineId) ?? 0;
    const left = roundQty(line.qty - moved);
    if (left > QTY_EPSILON) remainingLines.push({ ...line, qty: left });
    if (moved > 0) splitLines.push({ ...line, lineId: newId(), qty: roundQty(moved) });
  }

  if (remainingLines.length === 0) {
    return { ok: false, error: "That moves everything — leave at least one item on this bill." };
  }

  return {
    ok: true,
    remaining: { ...cart, lines: remainingLines },
    split: {
      ...cart,
      clientTxnId: newId(),
      heldAt: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      lines: splitLines,
    },
  };
}
