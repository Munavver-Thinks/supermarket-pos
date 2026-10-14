import type { Cart, CartLine } from "@pos/types";
import { describe, expect, it } from "vitest";

import { duplicateCart, mergeCarts, splitCart } from "@/core/business-logic/billTabs.js";

function ids(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: "l-dal",
    productId: "dal",
    name: "Toor Dal",
    uom: "pcs",
    qty: 1,
    unitPricePaise: 15000,
    isTaxInclusive: true,
    taxRatePercent: 0,
    discountPercent: 0,
    discountFlatPaise: 0,
    ...overrides,
  };
}

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    clientTxnId: "bill-a",
    storeId: "s",
    counterId: "c",
    userId: "u",
    customerId: null,
    lines: [],
    billDiscountPercent: 0,
    billDiscountFlatPaise: 0,
    heldAt: null,
    ...overrides,
  };
}

const oil = (overrides: Partial<CartLine> = {}) =>
  line({ lineId: "l-oil", productId: "oil", name: "Oil", unitPricePaise: 21000, ...overrides });

describe("duplicateCart", () => {
  it("copies the lines under new ids, with no customer", () => {
    const original = cart({
      customerId: "cust",
      heldAt: "2026-09-16T10:00:00Z",
      billDiscountPercent: 5,
      lines: [line(), oil(), line({ lineId: "l-rice", productId: "rice", name: "Rice" })],
    });
    const copy = duplicateCart(original, ids());

    expect(copy.clientTxnId).toBe("new-1");
    expect(copy.clientTxnId).not.toBe(original.clientTxnId);
    expect(copy.customerId).toBeNull();
    expect(copy.heldAt).toBeNull();
    expect(copy.billDiscountPercent).toBe(5);
    expect(copy.lines).toHaveLength(3);
    expect(copy.lines.map((l) => l.productId)).toEqual(["dal", "oil", "rice"]);
    expect(new Set(copy.lines.map((l) => l.lineId))).toEqual(new Set(["new-2", "new-3", "new-4"]));
    // The original is untouched.
    expect(original.lines[0]?.lineId).toBe("l-dal");
    expect(original.customerId).toBe("cust");
  });
});

describe("mergeCarts", () => {
  it("adds matching lines together and appends the rest", () => {
    const a = cart({ clientTxnId: "a", lines: [line({ qty: 2 })] });
    const b = cart({ clientTxnId: "b", lines: [line({ lineId: "b-dal", qty: 1 }), oil()] });
    const result = mergeCarts(b, a, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.cart.clientTxnId).toBe("b");
    expect(result.cart.lines.map((l) => [l.productId, l.qty])).toEqual([
      ["dal", 3],
      ["oil", 1],
    ]);
  });

  it("keeps lines at a different price or discount separate", () => {
    const target = cart({ clientTxnId: "t", lines: [line()] });
    const source = cart({
      clientTxnId: "s",
      lines: [line({ lineId: "s1", unitPricePaise: 14000 }), line({ lineId: "s2", discountPercent: 10 })],
    });
    const result = mergeCarts(target, source, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.cart.lines).toHaveLength(3);
    expect(result.cart.lines.slice(1).map((l) => l.lineId)).toEqual(["new-1", "new-2"]);
  });

  it("sums weighed quantities without float drift", () => {
    const target = cart({ clientTxnId: "t", lines: [line({ uom: "kg", qty: 0.1 })] });
    const source = cart({ clientTxnId: "s", lines: [line({ uom: "kg", qty: 0.2 })] });
    const result = mergeCarts(target, source, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.cart.lines[0]?.qty).toBe(0.3);
  });

  it("refuses bills for two different customers", () => {
    const result = mergeCarts(
      cart({ clientTxnId: "t", customerId: "x", lines: [line()] }),
      cart({ clientTxnId: "s", customerId: "y", lines: [line()] }),
      ids(),
    );
    expect(result).toEqual({ ok: false, error: "These bills are for different customers, so they can't be merged." });
  });

  it("takes the source's customer when the target has none, and keeps the target's otherwise", () => {
    const took = mergeCarts(
      cart({ clientTxnId: "t", lines: [line()] }),
      cart({ clientTxnId: "s", customerId: "y", lines: [oil()] }),
      ids(),
    );
    expect(took.ok && took.cart.customerId).toBe("y");

    const kept = mergeCarts(
      cart({ clientTxnId: "t", customerId: "x", lines: [line()] }),
      cart({ clientTxnId: "s", lines: [oil()] }),
      ids(),
    );
    expect(kept.ok && kept.cart.customerId).toBe("x");
  });

  it("refuses a source bill with a whole-bill discount, naming it", () => {
    expect(
      mergeCarts(
        cart({ clientTxnId: "t" }),
        cart({ clientTxnId: "s", billDiscountFlatPaise: 500, lines: [line()] }),
        ids(),
        "Bill 2",
      ),
    ).toEqual({ ok: false, error: "Clear the discount on Bill 2 first." });
    expect(
      mergeCarts(cart({ clientTxnId: "t" }), cart({ clientTxnId: "s", billDiscountPercent: 2, lines: [line()] }), ids())
        .ok,
    ).toBe(false);
  });

  it("refuses merging a bill into itself or an empty source", () => {
    const a = cart({ lines: [line()] });
    expect(mergeCarts(a, a, ids()).ok).toBe(false);
    expect(mergeCarts(cart({ clientTxnId: "t" }), cart({ clientTxnId: "s" }), ids()).ok).toBe(false);
  });
});

describe("splitCart", () => {
  const threeDal = cart({ customerId: "cust", billDiscountFlatPaise: 300, lines: [line({ qty: 3 }), oil()] });

  it("moves part of a line to a new bill and leaves the rest", () => {
    const result = splitCart(threeDal, { "l-dal": 1 }, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.remaining.clientTxnId).toBe("bill-a");
    expect(result.remaining.lines.map((l) => [l.productId, l.qty])).toEqual([
      ["dal", 2],
      ["oil", 1],
    ]);
    expect(result.remaining.billDiscountFlatPaise).toBe(300);

    expect(result.split.clientTxnId).not.toBe("bill-a");
    expect(result.split.customerId).toBe("cust");
    expect(result.split.billDiscountFlatPaise).toBe(0);
    expect(result.split.billDiscountPercent).toBe(0);
    expect(result.split.lines.map((l) => [l.productId, l.qty])).toEqual([["dal", 1]]);
    expect(result.split.lines[0]?.lineId).not.toBe("l-dal");

    // Nothing is lost or created: 3 dal in, 3 dal out.
    const dal = (c: Cart) => c.lines.filter((l) => l.productId === "dal").reduce((s, l) => s + l.qty, 0);
    expect(dal(result.remaining) + dal(result.split)).toBe(3);
  });

  it("removes a line taken in full from the original", () => {
    const result = splitCart(threeDal, { "l-oil": 1 }, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.remaining.lines.map((l) => l.productId)).toEqual(["dal"]);
    expect(result.split.lines.map((l) => l.productId)).toEqual(["oil"]);
  });

  it("splits loose items by weight within tolerance", () => {
    const loose = cart({ lines: [line({ uom: "kg", qty: 0.3 }), oil()] });
    const result = splitCart(loose, { "l-dal": 0.1 + 0.2 }, ids());
    if (!result.ok) throw new Error(result.error);
    expect(result.remaining.lines.map((l) => l.productId)).toEqual(["oil"]);
    expect(result.split.lines[0]?.qty).toBe(0.3);

    const part = splitCart(loose, { "l-dal": 0.1 }, ids());
    if (!part.ok) throw new Error(part.error);
    expect(part.remaining.lines[0]?.qty).toBe(0.2);
  });

  it("refuses when nothing is chosen", () => {
    expect(splitCart(threeDal, {}, ids()).ok).toBe(false);
    expect(splitCart(threeDal, { "l-dal": 0 }, ids()).ok).toBe(false);
  });

  it("refuses more than the line has", () => {
    expect(splitCart(threeDal, { "l-dal": 4 }, ids())).toEqual({ ok: false, error: "Toor Dal: only 3 pcs on the bill." });
  });

  it("refuses moving everything", () => {
    expect(splitCart(threeDal, { "l-dal": 3, "l-oil": 1 }, ids()).ok).toBe(false);
  });

  it("refuses a line that isn't on the bill", () => {
    expect(splitCart(threeDal, { "ghost": 1 }, ids()).ok).toBe(false);
  });
});
