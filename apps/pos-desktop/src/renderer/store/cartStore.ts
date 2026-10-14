import { create } from "zustand";
import { capLinesAtMrp, duplicateCart, mergeCarts, splitCart } from "@pos/business-logic";
import type { MrpLoweredLine } from "@pos/business-logic";
import type { Cart, CartLine, ProductSearchResult } from "@pos/types";

/**
 * A return picked on the Billing screen ("Return item…", F12) whose value will come off the
 * bill it's attached to, instead of being paid out on its own. Lives only on the renderer's
 * BillTab — never inside Cart itself, never saved to a draft, never sent to the server until
 * payment is confirmed (see billingCreateSale's 4th argument). At most one per bill tab.
 */
export interface PendingReturn {
  originalSaleId: string;
  originalBillNo: string;
  originalCustomerId: string | null;
  originalCustomerName: string | null;
  hadCreditPayment: boolean;
  lines: Array<{ saleItemId: string; productId: string; productName: string; uom: string; qty: number }>;
  reason: string | null;
  /** Client-side estimate for display only — the server recomputes this authoritatively. */
  refundPaise: number;
}

export interface BillTab {
  cart: Cart;
  label: string;
  /** See PendingReturn's doc comment. Absent/null on every tab except the one it was added to. */
  pendingReturn?: PendingReturn | null;
}

export interface BillContext {
  storeId: string;
  counterId: string;
  userId: string;
}

function emptyCart(ctx: BillContext): Cart {
  return {
    clientTxnId: crypto.randomUUID(),
    storeId: ctx.storeId,
    counterId: ctx.counterId,
    userId: ctx.userId,
    customerId: null,
    lines: [],
    billDiscountPercent: 0,
    billDiscountFlatPaise: 0,
    heldAt: null,
    isWholesale: false,
  };
}

interface CartState {
  bills: BillTab[];
  activeIndex: number;
  ensureAtLeastOneBill: (ctx: BillContext) => void;
  newBill: (ctx: BillContext) => void;
  switchBill: (index: number) => void;
  closeBill: (index: number) => void;
  addProduct: (product: ProductSearchResult, qty: number) => void;
  updateLineQty: (lineId: string, qty: number) => void;
  updateLineDiscount: (lineId: string, discountPercent: number, discountFlatPaise: number) => void;
  removeLine: (lineId: string) => void;
  setCustomer: (customerId: string | null) => void;
  setBillDiscount: (percent: number, flatPaise: number) => void;
  /** Whether a newly added line should use the wholesale rate. Doesn't touch lines already on
   * the bill — see addProduct. */
  setWholesale: (isWholesale: boolean) => void;
  replaceActiveCart: (cart: Cart) => void;
  restoreCart: (cart: Cart, label: string) => void;
  resetActiveBillAfterSale: (ctx: BillContext) => void;
  /** Opens a copy of the bill at `index` as a new tab, with no customer. */
  duplicateBill: (index: number) => void;
  /** Folds bill `sourceIndex` into `targetIndex` and closes the source. Returns the refusal, or null. */
  mergeBills: (sourceIndex: number, targetIndex: number) => string | null;
  /** Moves the chosen quantities (by line id) of bill `index` onto a new tab. Returns the refusal, or null. */
  splitBill: (index: number, take: Record<string, number>) => string | null;
  /** Attaches a customer to any open bill, not only the active one. */
  setCustomerForBill: (index: number, customerId: string | null) => void;
  /** Lowers the named bill's line prices to the given MRP caps, matched by clientTxnId rather
   * than activeIndex so a late-arriving response can't mutate whichever tab happens to be
   * active by the time it resolves. Returns what was lowered, whether or not anything was. */
  applyMrpCaps: (clientTxnId: string, caps: Record<string, number>) => MrpLoweredLine[];
  /** Attaches or clears the pending return on the named tab, matched by clientTxnId (like
   * applyMrpCaps) rather than activeIndex, so it can't land on the wrong tab if the active
   * one changed while a lookup was in flight. */
  setPendingReturn: (clientTxnId: string, pr: PendingReturn | null) => void;
}

const newId = (): string => crypto.randomUUID();

export const useCartStore = create<CartState>((set, get) => ({
  bills: [],
  activeIndex: 0,

  ensureAtLeastOneBill: (ctx) => {
    if (get().bills.length === 0) {
      set({ bills: [{ cart: emptyCart(ctx), label: "Bill 1" }], activeIndex: 0 });
    }
  },

  newBill: (ctx) => {
    const bills = get().bills;
    const nextNumber = bills.length + 1;
    set({
      bills: [...bills, { cart: emptyCart(ctx), label: `Bill ${nextNumber}` }],
      activeIndex: bills.length,
    });
  },

  switchBill: (index) => set({ activeIndex: index }),

  closeBill: (index) => {
    const bills = get().bills.filter((_, i) => i !== index);
    const activeIndex = Math.max(0, Math.min(get().activeIndex, bills.length - 1));
    set({ bills, activeIndex });
  },

  addProduct: (product, qty) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;

    const existingLine = current.cart.lines.find((l) => l.productId === product.productId);
    let lines: CartLine[];
    if (existingLine) {
      lines = current.cart.lines.map((l) =>
        l.productId === product.productId ? { ...l, qty: l.qty + qty } : l,
      );
    } else {
      // A product with no wholesale rate just sells at its normal price, even on a bill
      // marked wholesale — the toggle is a preference, not a promise every item has one.
      const unitPricePaise =
        current.cart.isWholesale && product.wholesalePricePaise != null
          ? product.wholesalePricePaise
          : product.salePricePaise;
      const newLine: CartLine = {
        lineId: crypto.randomUUID(),
        productId: product.productId,
        name: product.name,
        uom: product.uom,
        qty,
        unitPricePaise,
        isTaxInclusive: product.isTaxInclusive,
        taxRatePercent: product.taxRatePercent,
        discountPercent: 0,
        discountFlatPaise: 0,
      };
      lines = [...current.cart.lines, newLine];
    }

    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, lines } };
    set({ bills: updatedBills });
  },

  updateLineQty: (lineId, qty) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const lines = current.cart.lines.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(0, qty) } : l));
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, lines } };
    set({ bills: updatedBills });
  },

  updateLineDiscount: (lineId, discountPercent, discountFlatPaise) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const lines = current.cart.lines.map((l) =>
      l.lineId === lineId ? { ...l, discountPercent, discountFlatPaise } : l,
    );
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, lines } };
    set({ bills: updatedBills });
  },

  removeLine: (lineId) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const lines = current.cart.lines.filter((l) => l.lineId !== lineId);
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, lines } };
    set({ bills: updatedBills });
  },

  setCustomer: (customerId) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, customerId } };
    set({ bills: updatedBills });
  },

  setBillDiscount: (percent, flatPaise) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const updatedBills = [...bills];
    updatedBills[activeIndex] = {
      ...current,
      cart: { ...current.cart, billDiscountPercent: percent, billDiscountFlatPaise: flatPaise },
    };
    set({ bills: updatedBills });
  },

  setWholesale: (isWholesale) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart: { ...current.cart, isWholesale } };
    set({ bills: updatedBills });
  },

  replaceActiveCart: (cart) => {
    const { bills, activeIndex } = get();
    const current = bills[activeIndex];
    if (!current) return;
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { ...current, cart };
    set({ bills: updatedBills });
  },

  restoreCart: (cart, label) => {
    const bills = get().bills;
    set({ bills: [...bills, { cart, label }], activeIndex: bills.length });
  },

  resetActiveBillAfterSale: (ctx) => {
    const { bills, activeIndex } = get();
    const updatedBills = [...bills];
    updatedBills[activeIndex] = { cart: emptyCart(ctx), label: updatedBills[activeIndex]?.label ?? "Bill" };
    set({ bills: updatedBills });
  },

  duplicateBill: (index) => {
    const bills = get().bills;
    const source = bills[index];
    if (!source) return;
    set({
      bills: [...bills, { cart: duplicateCart(source.cart, newId), label: `${source.label} (copy)` }],
      activeIndex: bills.length,
    });
  },

  mergeBills: (sourceIndex, targetIndex) => {
    const { bills } = get();
    const source = bills[sourceIndex];
    const target = bills[targetIndex];
    if (!source || !target || sourceIndex === targetIndex) return "Choose two different bills.";
    // A pending return's value only makes sense against the bill it was picked for — folding
    // it silently into another bill would misattribute the credit. Refused rather than
    // dropped, so the cashier re-adds it deliberately after merging, or merges the other way.
    if (source.pendingReturn) return `Remove the return from ${source.label} first.`;
    const result = mergeCarts(target.cart, source.cart, newId, source.label);
    if (!result.ok) return result.error;

    const updated = bills.map((bill, i) => (i === targetIndex ? { ...bill, cart: result.cart } : bill));
    const remaining = updated.filter((_, i) => i !== sourceIndex);
    // Land on the merged bill, wherever it sits once the source tab is gone.
    set({ bills: remaining, activeIndex: targetIndex > sourceIndex ? targetIndex - 1 : targetIndex });
    return null;
  },

  splitBill: (index, take) => {
    const bills = get().bills;
    const current = bills[index];
    if (!current) return "That bill is no longer open.";
    const result = splitCart(current.cart, take, newId);
    if (!result.ok) return result.error;

    const updated = bills.map((bill, i) => (i === index ? { ...bill, cart: result.remaining } : bill));
    set({
      bills: [...updated, { cart: result.split, label: `${current.label} (split)` }],
      activeIndex: updated.length,
    });
    return null;
  },

  setCustomerForBill: (index, customerId) => {
    const bills = get().bills;
    const bill = bills[index];
    if (!bill) return;
    set({ bills: bills.map((b, i) => (i === index ? { ...b, cart: { ...b.cart, customerId } } : b)) });
  },

  applyMrpCaps: (clientTxnId, caps) => {
    const bills = get().bills;
    const index = bills.findIndex((b) => b.cart.clientTxnId === clientTxnId);
    const bill = bills[index];
    if (!bill) return [];

    const { lines, lowered } = capLinesAtMrp(bill.cart.lines, caps);
    if (lowered.length > 0) {
      const updatedBills = [...bills];
      updatedBills[index] = { ...bill, cart: { ...bill.cart, lines } };
      set({ bills: updatedBills });
    }
    return lowered;
  },

  setPendingReturn: (clientTxnId, pr) => {
    const bills = get().bills;
    const index = bills.findIndex((b) => b.cart.clientTxnId === clientTxnId);
    const bill = bills[index];
    if (!bill) return;
    const updatedBills = [...bills];
    updatedBills[index] = { ...bill, pendingReturn: pr };
    set({ bills: updatedBills });
  },
}));
