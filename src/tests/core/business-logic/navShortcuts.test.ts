import { describe, expect, it } from "vitest";

import { NAV_SHORTCUTS, navShortcutLabel, resolveNavShortcut } from "@/core/business-logic/navShortcuts.js";
import type { NavShortcutKeyEvent } from "@/core/business-logic/navShortcuts.js";

function press(key: string, mods: Partial<NavShortcutKeyEvent> = {}): NavShortcutKeyEvent {
  return { key, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...mods };
}

const ALL_SCREENS = new Set(NAV_SHORTCUTS.map((b) => b.screen));

describe("resolveNavShortcut", () => {
  it.each(NAV_SHORTCUTS.map((b) => [b.key, b.screen] as const))(
    "Ctrl+%s switches to %s",
    (key, screen) => {
      expect(resolveNavShortcut(press(key), ALL_SCREENS, false)).toBe(screen);
    },
  );

  it("matches a letter regardless of case", () => {
    expect(resolveNavShortcut(press("D"), ALL_SCREENS, false)).toBe("dashboard");
  });

  it("does nothing without Ctrl held — a bare letter must reach the text field it's typed into", () => {
    expect(resolveNavShortcut(press("d", { ctrlKey: false }), ALL_SCREENS, false)).toBeNull();
  });

  it("does nothing with Shift held — Ctrl+Shift+D must not be confused with Ctrl+D", () => {
    expect(resolveNavShortcut(press("d", { shiftKey: true }), ALL_SCREENS, false)).toBeNull();
  });

  it("does nothing with Alt or Meta held", () => {
    expect(resolveNavShortcut(press("d", { altKey: true }), ALL_SCREENS, false)).toBeNull();
    expect(resolveNavShortcut(press("d", { metaKey: true }), ALL_SCREENS, false)).toBeNull();
  });

  it("never binds Ctrl+A/C/V/X/Z — every text field in the app needs these", () => {
    for (const key of ["a", "c", "v", "x", "z"]) {
      expect(resolveNavShortcut(press(key), ALL_SCREENS, false)).toBeNull();
    }
  });

  it("ignores an auto-repeated key and a key mid-IME composition", () => {
    expect(resolveNavShortcut(press("d", { repeat: true }), ALL_SCREENS, false)).toBeNull();
    expect(resolveNavShortcut(press("d", { isComposing: true }), ALL_SCREENS, false)).toBeNull();
  });

  it("does nothing while a modal dialog is open", () => {
    expect(resolveNavShortcut(press("d"), ALL_SCREENS, true)).toBeNull();
  });

  it("refuses a screen the signed-in role can't see, even though the key is bound", () => {
    const cashierScreens = new Set(["dashboard", "billing", "sales", "customers", "returns"]);
    expect(resolveNavShortcut(press("o"), cashierScreens, false)).toBeNull(); // reports: owner/manager only
    expect(resolveNavShortcut(press("b"), cashierScreens, false)).toBe("billing");
  });

  it("does nothing for an unbound key", () => {
    expect(resolveNavShortcut(press("q"), ALL_SCREENS, false)).toBeNull();
  });
});

describe("navShortcutLabel", () => {
  it("prints the bound key for a screen that has one", () => {
    expect(navShortcutLabel("billing")).toBe("Ctrl+B");
    expect(navShortcutLabel("settings")).toBe("Ctrl+,");
  });

  it("is empty for a screen with no shortcut", () => {
    expect(navShortcutLabel("ai")).toBe("");
  });
});
