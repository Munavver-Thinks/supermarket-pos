/**
 * Jumps straight to a main section of the app — Dashboard, Billing, Inventory, and so on —
 * from anywhere. A separate, app-wide namespace from billing's own F-key shortcuts (see
 * billingShortcuts.ts), which only live on the billing screen while it has focus.
 *
 * Why Ctrl+<letter>, not Shift+<letter> or a bare function key:
 * - Shift+<letter> is indistinguishable from typing a capital letter. Binding it globally
 *   would silently break typing a capitalised product name, customer name or note in any
 *   text field in the app — billingShortcuts.ts rules it out for the same reason, and this
 *   follows the same rule rather than inventing a second one.
 * - The bare function keys are already billing's own namespace and only live on that one
 *   screen; reusing them here would collide the moment someone on Billing reaches for F2.
 * - Ctrl is never held during normal typing, so Ctrl+<letter> is safe to resolve regardless
 *   of what has focus — unlike a bare letter, it needs no "is a text field focused" check.
 * - Ctrl+<letter> is genuinely free to use in the shipped app: the packaged build runs with
 *   no application menu at all (Menu.setApplicationMenu(null) in main/index.ts), so there
 *   are no Electron menu accelerators left to collide with. (`pnpm dev` keeps the default
 *   menu, so Ctrl+R / Ctrl+W / Ctrl+Shift+I are reserved there — a development convenience,
 *   not a limit on what the real app can bind.) The letters below still avoid Ctrl+A/C/V/X/Z
 *   (select all, copy, paste, cut, undo), which every text field in the app needs to keep
 *   working, and avoid the first letter where it would collide with a strong, unrelated
 *   convention (P for print, R for reload/refresh, N for "new").
 */

export interface NavShortcutBinding {
  /** Lowercase — KeyboardEvent.key for a letter stays lowercase while only Ctrl is held. */
  key: string;
  screen: string;
  /** How the key is written next to the nav label and in any shortcut list. */
  label: string;
}

export const NAV_SHORTCUTS: readonly NavShortcutBinding[] = [
  { key: "d", screen: "dashboard", label: "Ctrl+D" },
  { key: "b", screen: "billing", label: "Ctrl+B" },
  { key: "i", screen: "inventory", label: "Ctrl+I" },
  { key: "s", screen: "sales", label: "Ctrl+S" },
  { key: "u", screen: "customers", label: "Ctrl+U" },
  { key: "h", screen: "purchases", label: "Ctrl+H" },
  { key: "l", screen: "suppliers", label: "Ctrl+L" },
  { key: "e", screen: "returns", label: "Ctrl+E" },
  { key: "o", screen: "reports", label: "Ctrl+O" },
  { key: "m", screen: "employees", label: "Ctrl+M" },
  // Ctrl+, for Settings matches the convention several well-known apps already use.
  { key: ",", screen: "settings", label: "Ctrl+," },
];

/** The key to print next to a nav item for its screen, e.g. "Ctrl+D". Empty if it has none. */
export function navShortcutLabel(screen: string): string {
  return NAV_SHORTCUTS.find((b) => b.screen === screen)?.label ?? "";
}

/** The parts of a DOM KeyboardEvent the resolver reads — a KeyboardEvent satisfies it as-is. */
export interface NavShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

/**
 * The screen to switch to, or null to let the key through untouched. `allowedScreens` is
 * whatever the signed-in role may see — the same filter the nav rail itself applies, so a
 * shortcut can never jump somewhere the rail wouldn't show. `blocked` is true while any modal
 * dialog is open (manager approval, payment, a product form…) — switching screens out from
 * under one of those would be a confusing way to lose track of where a bill or edit stood.
 */
export function resolveNavShortcut(
  event: NavShortcutKeyEvent,
  allowedScreens: ReadonlySet<string>,
  blocked: boolean,
): string | null {
  if (event.repeat || event.isComposing || blocked) return null;
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null;
  const binding = NAV_SHORTCUTS.find((b) => b.key === event.key.toLowerCase());
  if (!binding || !allowedScreens.has(binding.screen)) return null;
  return binding.screen;
}
