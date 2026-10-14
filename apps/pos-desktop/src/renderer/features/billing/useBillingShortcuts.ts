import { useEffect, useRef } from "react";
import { resolveBillingShortcut } from "@pos/business-logic";
import type { BillingShortcutAction, BillingShortcutState, ShortcutFocusKind } from "@pos/business-logic";

/**
 * Ids the shortcuts move focus to. Ids rather than refs because the targets live in sibling
 * components (search, customer bar, cart) and threading refs through all of them would couple
 * every panel to the keyboard layer.
 */
export const BILLING_FOCUS_IDS = {
  search: "billing-search",
  /** The attach input, or the Remove button once a customer is attached. */
  customer: "billing-customer",
  billDiscount: "bill-discount",
} as const;

export function lineQtyInputId(lineId: string): string {
  return `line-qty-${lineId}`;
}

export function paymentFieldId(mode: string): string {
  return `pay-${mode}`;
}

export function focusById(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  // Selected, so the cashier's next keystrokes replace the value rather than append to it.
  if (el instanceof HTMLInputElement) el.select();
}

const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset"]);
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "number", "tel", "email", "password", "url"]);

function describeFocus(el: Element | null): { focus: ShortcutFocusKind; focusedFieldHasText: boolean } {
  if (!el || el === document.body) return { focus: "none", focusedFieldHasText: false };
  if (el instanceof HTMLInputElement) {
    if (BUTTON_INPUT_TYPES.has(el.type)) return { focus: "button", focusedFieldHasText: false };
    if (TEXT_INPUT_TYPES.has(el.type)) return { focus: "text", focusedFieldHasText: el.value.length > 0 };
    return { focus: "other", focusedFieldHasText: false };
  }
  if (el instanceof HTMLTextAreaElement) return { focus: "text", focusedFieldHasText: el.value.length > 0 };
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute("role") === "button") {
    return { focus: "button", focusedFieldHasText: false };
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return { focus: "text", focusedFieldHasText: (el.textContent ?? "").length > 0 };
  }
  return { focus: "other", focusedFieldHasText: false };
}

export type ScreenShortcutState = Omit<BillingShortcutState, "focus" | "focusedFieldHasText">;

/**
 * The one keyboard layer for the billing screen. Mounted by BillingScreen, so the keys are
 * live only while billing is on screen and vanish with it.
 *
 * `getState` and `onAction` are read through a ref at key time: the listener is added once
 * per mount, so re-renders (every keystroke, every bill-tab switch) never add a second one.
 */
export function useBillingShortcuts(
  getState: () => ScreenShortcutState,
  onAction: (action: BillingShortcutAction) => void,
): void {
  const latest = useRef({ getState, onAction });
  latest.current = { getState, onAction };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // The theme windows render outside the billing screen, so the shortcut layer still reads
      // "screen" while one is open; keys typed inside them must not reach billing.
      const active = document.activeElement;
      if (active?.closest('[role="dialog"]') && !active.closest(".billing-screen")) return;
      const action = resolveBillingShortcut(event, {
        ...latest.current.getState(),
        ...describeFocus(document.activeElement),
      });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onAction(action);
    }

    // Capture phase, so a matched key is settled before any input's own onKeyDown sees it
    // (Enter confirming payment must not also reach the amount box). Unmatched keys pass
    // straight through to the inputs untouched.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);
}
