import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { cycleFocusIndex, resolveModalNavKey } from "@pos/business-logic";
import type { ModalNavFocusKind } from "@pos/business-logic";

/**
 * Traps Tab focus inside a modal and gives it the arrow-key navigation convention described
 * in modalKeyNav.ts, for every modal in the app. A hook rather than a wrapper component: this
 * codebase's 18+ modal files each hand-roll their own modal-backdrop/modal-card structure with
 * bespoke Escape-handling and autofocus already, so a ~3-line hook call is far less disruptive
 * than restructuring their JSX around a wrapper.
 *
 * Stacked dialogs (e.g. ManagerApprovalDialog opened on top of StockAdjustModal, or as a
 * sibling over PaymentModal in BillingScreen): a module-level stack of open traps, push on
 * mount and pop on unmount — only the TOP one handles keys.
 */
const openTraps: symbol[] = [];

const FOCUSABLE_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

function describeModalFocus(el: Element | null): ModalNavFocusKind {
  if (el?.closest('[data-modal-nav="native"]')) return "native";
  if (el instanceof HTMLInputElement) {
    if (el.type === "radio") return "radio";
    if (el.type === "checkbox") return "checkbox";
    if (el.type === "button" || el.type === "submit" || el.type === "reset") return "button";
    return "text";
  }
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el?.getAttribute("role") === "button") {
    return "button";
  }
  return "none";
}

/** Queried fresh at every keypress (never cached) — conditionally-rendered elements (like a
 * change-choice button, or a Confirm button that's disabled until canConfirm) are always
 * correctly picked up or skipped. */
function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !(el as HTMLButtonElement | HTMLInputElement).disabled &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0 &&
      // Excludes a NESTED modal's own elements from this (outer) modal's trap — what makes
      // the stacking rule above correct.
      el.closest(".modal-card") === container,
  );
}

export function useModalKeyboard<T extends HTMLElement>(
  containerRef: RefObject<T>,
  options: { arrowNav?: boolean } = {},
): void {
  const arrowNav = options.arrowNav ?? true;
  const latestArrowNav = useRef(arrowNav);
  latestArrowNav.current = arrowNav;

  useEffect(() => {
    const token = Symbol("modal-trap");
    openTraps.push(token);

    function handleKeyDown(event: KeyboardEvent): void {
      // Only the topmost open trap handles keys (F2 — correct stacking for nested/sibling
      // dialogs).
      if (openTraps[openTraps.length - 1] !== token) return;
      const container = containerRef.current;
      if (!container) return;

      const elements = focusableElements(container);
      const active = document.activeElement;
      const currentIndex = active ? elements.indexOf(active as HTMLElement) : -1;
      const focusKind = describeModalFocus(active);

      const move = resolveModalNavKey(event, focusKind, latestArrowNav.current);
      if (!move) return;

      event.preventDefault();
      const nextIndex = cycleFocusIndex(currentIndex, elements.length, move);
      const target = elements[nextIndex];
      if (!target) return;
      target.focus();
      if (describeModalFocus(target) === "text") (target as HTMLInputElement).select();
    }

    // Bubble phase (never capture): the billing screen's capture-phase shortcut listener and
    // each modal's own Escape handling must run first, and anything that calls
    // preventDefault() on an arrow key wins (this hook checks event.defaultPrevented).
    window.addEventListener("keydown", handleKeyDown);

    // F7: scheduled once, after every modal's own existing autofocus logic has had its render
    // (autoFocus attributes, a useEffect's focus-and-select, ManagerApprovalDialog's
    // error-triggered refocus, PaymentModal's cash-field focus). Only a fallback — if
    // something already focused an element inside the modal by the time this frame runs, it
    // does nothing.
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;
      const first = focusableElements(container)[0];
      first?.focus();
    });

    return () => {
      const index = openTraps.indexOf(token);
      if (index !== -1) openTraps.splice(index, 1);
      window.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [containerRef]);
}
