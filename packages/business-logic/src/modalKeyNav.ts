/**
 * Pure key-resolution for the Tab-trap + arrow-key navigation convention every modal in the
 * app follows (see useModalKeyboard.ts for the thin renderer hook that calls this). Matches
 * this codebase's existing pure-resolver-plus-thin-renderer-hook shape
 * (billingShortcuts.ts/navShortcuts.ts).
 *
 * Listener placement (bubble phase, never capture): the hook registers one `window` keydown
 * listener per mount, on the bubble phase, so the billing screen's own capture-phase F-key/
 * Enter/Escape listener and each modal's own Escape listener (capture or bubble) all run
 * FIRST — anything that calls preventDefault() on an arrow key wins, because this resolver
 * checks and ignores `event.defaultPrevented`. This resolver never handles Escape, Enter or
 * any F-key, so it never needs to touch billingShortcuts.ts's "dialog" layer rule, and it
 * ignores Ctrl/Alt/Meta entirely so it never collides with navShortcuts.ts's Ctrl+letter
 * bindings (and Alt+Down is passed through untouched, so it still opens a native <select>).
 *
 * The key-resolution table:
 *   Tab / Shift+Tab   -> next / previous, for EVERY focus kind, always wraps, never leaves
 *                        the modal.
 *   ArrowDown/Up      -> next / previous, for: text-like inputs, select, button, checkbox,
 *                        and when nothing is focused.
 *   ArrowRight/Left   -> next / previous, ONLY for: button, checkbox, and when nothing is
 *                        focused.
 *   Shift+Arrow       -> always left to native behaviour (text selection).
 * Left entirely alone (native, this resolver returns null): a radio input (radio groups
 * already move/select with arrows natively), a textarea, anything under an ancestor with
 * data-modal-nav="native", and Left/Right inside a text/number/date input or a <select>
 * (caret movement / date-segment movement / native option cycling).
 *
 * The deliberate number-stepper tradeoff (F5): inside a modal, ArrowUp/ArrowDown on a
 * type="number" input now moves between FIELDS instead of stepping that input's own numeric
 * value. This is intentional — cashiers type amounts; a +/-0.01 native stepper on a money
 * field is essentially useless, and quantity entry already goes through QuantityModal's own
 * dedicated flow. The same applies to <select> (native Up/Down option-cycling is superseded;
 * Left/Right, typing the option's first letter, Alt+Down or the mouse still change it) and to
 * type="date" inputs (native Up/Down segment-stepping is superseded; typing digits directly
 * still works). None of this reaches outside a modal — this resolver (and the hook that calls
 * it) is only ever used inside one.
 */

export type ModalNavFocusKind = "text" | "select" | "button" | "checkbox" | "radio" | "textarea" | "native" | "none";

export type ModalNavMove = "next" | "prev";

/** The parts of a DOM KeyboardEvent the resolver reads — a KeyboardEvent satisfies it as-is. */
export interface ModalNavKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

const ARROW_DOWN_UP_KINDS: ReadonlySet<ModalNavFocusKind> = new Set(["text", "select", "button", "checkbox", "none"]);
const ARROW_LEFT_RIGHT_KINDS: ReadonlySet<ModalNavFocusKind> = new Set(["button", "checkbox", "none"]);
const NATIVE_ARROW_KINDS: ReadonlySet<ModalNavFocusKind> = new Set(["radio", "textarea", "native"]);

/**
 * The move a key press should trigger, or null to let the key through untouched (native
 * behaviour). When `arrowNav` is false, only Tab/Shift+Tab resolve to anything — used by
 * ShortcutHelpOverlay, which needs its list's native arrow-key scrolling left alone.
 */
export function resolveModalNavKey(
  event: ModalNavKeyEvent,
  focus: ModalNavFocusKind,
  arrowNav: boolean,
): ModalNavMove | null {
  if (event.isComposing || event.defaultPrevented) return null;
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  if (event.key === "Tab") return event.shiftKey ? "prev" : "next";
  if (!arrowNav) return null;
  // Shift+Arrow is always left to native behaviour (text selection).
  if (event.shiftKey) return null;
  if (NATIVE_ARROW_KINDS.has(focus)) return null;

  switch (event.key) {
    case "ArrowDown":
      return ARROW_DOWN_UP_KINDS.has(focus) ? "next" : null;
    case "ArrowUp":
      return ARROW_DOWN_UP_KINDS.has(focus) ? "prev" : null;
    case "ArrowRight":
      return ARROW_LEFT_RIGHT_KINDS.has(focus) ? "next" : null;
    case "ArrowLeft":
      return ARROW_LEFT_RIGHT_KINDS.has(focus) ? "prev" : null;
    default:
      return null;
  }
}

/** Wraps at both ends like billingShortcuts.ts's cycleBillIndex. `current === -1` means focus
 * is currently outside the container: "next" gives the first element, "prev" the last. */
export function cycleFocusIndex(current: number, count: number, move: ModalNavMove): number {
  if (count <= 0) return 0;
  if (current === -1) return move === "next" ? 0 : count - 1;
  const direction = move === "next" ? 1 : -1;
  return ((current + direction) % count + count) % count;
}
