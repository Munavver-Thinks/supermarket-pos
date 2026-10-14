import type { PaymentInput } from "@pos/types";

/**
 * Keyboard shortcuts for the billing counter, as pure data plus one resolver, so the rules
 * (which key does what, and when it must do nothing) are testable without a window.
 *
 * Key choices, for a cashier on a stock Electron build under Windows:
 * - Function keys carry almost everything. They never type a character, so they work from
 *   any box without stealing a keystroke, and a cashier can find them without looking.
 * - F10 is now bound (toggleWholesale): the packaged app runs with no application menu
 *   (Menu.setApplicationMenu(null) in main/index.ts), so there is no menu bar left for it to
 *   focus. Only `pnpm dev` keeps the default menu, where F10 still does that — a development
 *   inconvenience, same as the next point, not a limit on the shipped app. Alt is still left
 *   alone: it hands focus to the window's menu bar as well, on both builds.
 * - F12 is now bound too (returnAgainstBill): unbound in Electron's default menu on both the
 *   packaged app (no menu bar at all, as above) and `pnpm dev` (F12 there normally opens
 *   devtools, but this app's devtools shortcut is Ctrl+Shift+I, so F12 is free on both).
 *   F11 (fullscreen), Ctrl+R / Ctrl+Shift+R (reload — loses the bill mid-sale), Ctrl+W
 *   (closes the window) and Ctrl+Shift+I (devtools) are bound by Electron's default menu.
 * - Removing a line is Ctrl+Delete rather than a bare key, since it throws work away, and it
 *   stands down while the focused box has text so Ctrl+Delete still deletes a word there.
 * - Letters, digits, Backspace and a bare Enter on the bill screen are never bound — typing
 *   and barcode scanners (which end each scan with Enter) must reach the inputs untouched.
 */

/**
 * Which surface is on top. Only the topmost one's shortcuts are live. "dialog" is any other
 * modal (manager approval, split/merge bill) and has no bindings at all, so Enter or F9 typed
 * into it can never confirm a payment underneath.
 */
export type BillingShortcutLayer = "screen" | "payment" | "recovery" | "help" | "dialog";

export type BillingShortcutAction =
  | "toggleHelp"
  | "closeHelp"
  | "focusSearch"
  | "focusCustomer"
  | "focusBillDiscount"
  | "toggleWholesale"
  | "focusLastLineQty"
  | "removeLastLine"
  | "newBill"
  | "prevBill"
  | "nextBill"
  | "openPayment"
  | "returnAgainstBill"
  | "focusCash"
  | "focusUpi"
  | "focusCard"
  | "focusCredit"
  | "confirmPayment"
  | "cancelPayment"
  | "closeRecovery";

/** The parts of a DOM KeyboardEvent the resolver reads — a KeyboardEvent satisfies it as-is. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

/** What kind of element has keyboard focus. */
export type ShortcutFocusKind = "none" | "text" | "button" | "other";

export interface BillingShortcutState {
  layer: BillingShortcutLayer;
  lineCount: number;
  billCount: number;
  /** False when the bill can't be paid yet — empty, or blocked by the stock policy. */
  canCheckout: boolean;
  /** Balance is zero and nothing (credit limit, a sale in flight) stops confirmation. */
  canConfirmPayment: boolean;
  paymentSubmitting: boolean;
  focus: ShortcutFocusKind;
  focusedFieldHasText: boolean;
}

export interface BillingShortcutBinding {
  /** "any" is live whatever is on top. */
  layer: BillingShortcutLayer | "any";
  /** KeyboardEvent.key. */
  key: string;
  ctrl: boolean;
  action: BillingShortcutAction;
  /** How the key is written on buttons and in the help list. */
  label: string;
  description: string;
}

function bind(
  layer: BillingShortcutBinding["layer"],
  key: string,
  action: BillingShortcutAction,
  description: string,
  ctrl = false,
): BillingShortcutBinding {
  return { layer, key, ctrl, action, description, label: `${ctrl ? "Ctrl+" : ""}${key === "Escape" ? "Esc" : key}` };
}

/**
 * The whole map. The resolver and the on-screen help both read this list, so the help can't
 * drift from what the keys actually do. Order matters only where one action has two keys:
 * the first is the one shown on buttons.
 */
export const BILLING_SHORTCUTS: readonly BillingShortcutBinding[] = [
  bind("any", "F1", "toggleHelp", "Show or hide this list of shortcuts"),

  bind("screen", "F2", "focusSearch", "Search or scan a product"),
  bind("screen", "F3", "focusCustomer", "Attach a customer by name or phone"),
  bind("screen", "F4", "focusBillDiscount", "Discount on the whole bill"),
  // Next to F4 on the same key group: fix the item just scanned before reaching for payment.
  bind("screen", "F5", "focusLastLineQty", "Change the quantity of the last item"),
  bind("screen", "Delete", "removeLastLine", "Remove the last item from the bill", true),
  bind("screen", "F6", "newBill", "Start a new bill, keeping this one open"),
  bind("screen", "F7", "prevBill", "Previous open bill"),
  bind("screen", "F8", "nextBill", "Next open bill"),
  bind("screen", "F9", "openPayment", "Take payment"),
  bind("screen", "F10", "toggleWholesale", "Switch this bill between retail and wholesale pricing"),
  bind("screen", "F12", "returnAgainstBill", "Take back items from an earlier bill on this one"),

  // Inside the payment window the bill's fields are hidden, so F2–F5 are reused for the
  // four tender boxes, in the order they appear.
  bind("payment", "F2", "focusCash", "Cash amount"),
  bind("payment", "F3", "focusUpi", "UPI amount"),
  bind("payment", "F4", "focusCard", "Card amount"),
  bind("payment", "F5", "focusCredit", "Credit (khata) amount"),
  bind("payment", "Enter", "confirmPayment", "Confirm, once the balance is zero"),
  // Cash is prefilled with the full amount, so F9 then F9 rings up an exact-cash bill — the
  // most common sale at a kirana counter.
  bind("payment", "F9", "confirmPayment", "Confirm, once the balance is zero"),
  bind("payment", "Escape", "cancelPayment", "Cancel and go back to the bill"),

  bind("recovery", "Escape", "closeRecovery", "Close the unfinished-bills window"),
  bind("help", "Escape", "closeHelp", "Close this list"),
];

export const PAYMENT_MODE_SHORTCUT: Record<PaymentInput["mode"], BillingShortcutAction> = {
  cash: "focusCash",
  upi: "focusUpi",
  card: "focusCard",
  credit: "focusCredit",
};

/** The key to print on a button for an action, e.g. "F9". Empty if the action has no key. */
export function billingShortcutLabel(action: BillingShortcutAction): string {
  return BILLING_SHORTCUTS.find((b) => b.action === action)?.label ?? "";
}

/**
 * Topmost layer wins: a dialog sits over everything (it is opened from the payment window or
 * the bill), then help, then a modal over the bill screen.
 */
export function topShortcutLayer(open: {
  help: boolean;
  recovery: boolean;
  payment: boolean;
  dialog?: boolean;
}): BillingShortcutLayer {
  if (open.dialog) return "dialog";
  if (open.help) return "help";
  if (open.recovery) return "recovery";
  if (open.payment) return "payment";
  return "screen";
}

/** Steps through bill tabs, wrapping at either end. */
export function cycleBillIndex(current: number, count: number, direction: -1 | 1): number {
  if (count <= 0) return 0;
  return (((current + direction) % count) + count) % count;
}

function isAvailable(binding: BillingShortcutBinding, state: BillingShortcutState): boolean {
  switch (binding.action) {
    case "focusLastLineQty":
      return state.lineCount > 0;
    case "removeLastLine":
      return state.lineCount > 0 && !(state.focus === "text" && state.focusedFieldHasText);
    case "prevBill":
    case "nextBill":
      return state.billCount > 1;
    case "openPayment":
      return state.canCheckout && state.lineCount > 0;
    case "confirmPayment":
      // Enter on a focused button already clicks it — confirming as well would act twice,
      // and on Cancel would do the opposite of what the cashier chose.
      return (
        state.canConfirmPayment && !state.paymentSubmitting && !(binding.key === "Enter" && state.focus === "button")
      );
    case "cancelPayment":
      // A sale is being written; walking away mid-write would hide its outcome.
      return !state.paymentSubmitting;
    default:
      return true;
  }
}

/**
 * The action a key press should trigger, or null to let the key through untouched. Null is
 * also the answer when an action exists but can't run right now (payment on an empty bill),
 * so the caller never has to second-guess the result.
 */
export function resolveBillingShortcut(event: ShortcutKeyEvent, state: BillingShortcutState): BillingShortcutAction | null {
  // A held key auto-repeats; holding F9 must not open payment and then confirm it. And a
  // key pressed mid-composition belongs to the IME (Tamil input), not to us.
  if (event.repeat || event.isComposing) return null;
  // No binding uses Shift, Alt or Win. Alt in particular opens the window menu on Windows.
  if (event.shiftKey || event.altKey || event.metaKey) return null;
  // Not even F1: a dialog owns the keyboard until it is closed.
  if (state.layer === "dialog") return null;

  const binding = BILLING_SHORTCUTS.find(
    (b) => (b.layer === "any" || b.layer === state.layer) && b.key === event.key && b.ctrl === event.ctrlKey,
  );
  if (!binding || !isAvailable(binding, state)) return null;
  return binding.action;
}
