import { describe, expect, it } from "vitest";

import {
  BILLING_SHORTCUTS,
  billingShortcutLabel,
  cycleBillIndex,
  resolveBillingShortcut,
  topShortcutLayer,
} from "@/core/business-logic/billingShortcuts.js";
import type { BillingShortcutState, ShortcutKeyEvent } from "@/core/business-logic/billingShortcuts.js";

function press(key: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, ...mods };
}

/** A bill with items, payable, cursor in an empty search box. */
function state(overrides: Partial<BillingShortcutState> = {}): BillingShortcutState {
  return {
    layer: "screen",
    lineCount: 3,
    billCount: 2,
    canCheckout: true,
    canConfirmPayment: true,
    paymentSubmitting: false,
    focus: "text",
    focusedFieldHasText: false,
    ...overrides,
  };
}

describe("resolveBillingShortcut — bill screen", () => {
  it.each([
    ["F1", "toggleHelp"],
    ["F2", "focusSearch"],
    ["F3", "focusCustomer"],
    ["F4", "focusBillDiscount"],
    ["F5", "focusLastLineQty"],
    ["F6", "newBill"],
    ["F7", "prevBill"],
    ["F8", "nextBill"],
    ["F9", "openPayment"],
    ["F10", "toggleWholesale"],
    ["F12", "returnAgainstBill"],
  ])("%s → %s", (key, action) => {
    expect(resolveBillingShortcut(press(key), state())).toBe(action);
  });

  it("works whatever has focus", () => {
    for (const focus of ["none", "text", "button", "other"] as const) {
      expect(resolveBillingShortcut(press("F9"), state({ focus, focusedFieldHasText: focus === "text" }))).toBe(
        "openPayment",
      );
    }
  });

  it("never takes ordinary typing keys", () => {
    for (const key of ["a", "Z", "2", " ", "Enter", "Backspace", "Delete", "Escape", "Tab", "ArrowDown", "-", "+"]) {
      expect(resolveBillingShortcut(press(key), state({ focusedFieldHasText: true }))).toBeNull();
      expect(resolveBillingShortcut(press(key), state({ focus: "none" }))).toBeNull();
    }
  });

  it("leaves keys Electron's default menu and Windows already use alone", () => {
    expect(resolveBillingShortcut(press("r", { ctrlKey: true }), state())).toBeNull();
    expect(resolveBillingShortcut(press("w", { ctrlKey: true }), state())).toBeNull();
    // F10 and F12 are bound now (toggleWholesale, returnAgainstBill) — see the top-of-file
    // comment on why that's safe.
    expect(resolveBillingShortcut(press("F11"), state())).toBeNull();
  });

  it("ignores F-keys with Shift, Alt, Ctrl or Win held", () => {
    expect(resolveBillingShortcut(press("F9", { shiftKey: true }), state())).toBeNull();
    expect(resolveBillingShortcut(press("F9", { altKey: true }), state())).toBeNull();
    expect(resolveBillingShortcut(press("F9", { ctrlKey: true }), state())).toBeNull();
    expect(resolveBillingShortcut(press("F9", { metaKey: true }), state())).toBeNull();
  });

  it("ignores auto-repeat and IME composition", () => {
    expect(resolveBillingShortcut(press("F9", { repeat: true }), state())).toBeNull();
    expect(resolveBillingShortcut(press("F2", { isComposing: true }), state())).toBeNull();
  });

  it("does not open payment on an empty or blocked bill", () => {
    expect(resolveBillingShortcut(press("F9"), state({ lineCount: 0, canCheckout: false }))).toBeNull();
    expect(resolveBillingShortcut(press("F9"), state({ lineCount: 0, canCheckout: true }))).toBeNull();
    expect(resolveBillingShortcut(press("F9"), state({ canCheckout: false }))).toBeNull();
  });

  it("only switches bills when there is another to switch to", () => {
    expect(resolveBillingShortcut(press("F7"), state({ billCount: 1 }))).toBeNull();
    expect(resolveBillingShortcut(press("F8"), state({ billCount: 1 }))).toBeNull();
    expect(resolveBillingShortcut(press("F6"), state({ billCount: 1 }))).toBe("newBill");
  });

  it("has no last-line actions on an empty bill", () => {
    expect(resolveBillingShortcut(press("F5"), state({ lineCount: 0 }))).toBeNull();
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true }), state({ lineCount: 0 }))).toBeNull();
  });

  it("removes the last line with Ctrl+Delete unless the focused box has text to edit", () => {
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true }), state())).toBe("removeLastLine");
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true }), state({ focus: "none" }))).toBe("removeLastLine");
    expect(
      resolveBillingShortcut(press("Delete", { ctrlKey: true }), state({ focus: "text", focusedFieldHasText: true })),
    ).toBeNull();
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true, shiftKey: true }), state())).toBeNull();
  });

  it("does not use payment-window keys on the bill screen", () => {
    expect(resolveBillingShortcut(press("Enter"), state({ focus: "none" }))).toBeNull();
    expect(resolveBillingShortcut(press("Escape"), state())).toBeNull();
  });
});

describe("resolveBillingShortcut — payment window", () => {
  const pay = (o: Partial<BillingShortcutState> = {}): BillingShortcutState => state({ layer: "payment", ...o });

  it.each([
    ["F2", "focusCash"],
    ["F3", "focusUpi"],
    ["F4", "focusCard"],
    ["F5", "focusCredit"],
    ["F9", "confirmPayment"],
    ["Enter", "confirmPayment"],
    ["Escape", "cancelPayment"],
    ["F1", "toggleHelp"],
  ])("%s → %s", (key, action) => {
    expect(resolveBillingShortcut(press(key), pay())).toBe(action);
  });

  it("does not confirm while there is a balance or a credit problem", () => {
    expect(resolveBillingShortcut(press("Enter"), pay({ canConfirmPayment: false }))).toBeNull();
    expect(resolveBillingShortcut(press("F9"), pay({ canConfirmPayment: false }))).toBeNull();
  });

  it("does not confirm twice while a sale is being saved, nor cancel under it", () => {
    expect(resolveBillingShortcut(press("Enter"), pay({ paymentSubmitting: true }))).toBeNull();
    expect(resolveBillingShortcut(press("F9"), pay({ paymentSubmitting: true }))).toBeNull();
    expect(resolveBillingShortcut(press("Escape"), pay({ paymentSubmitting: true }))).toBeNull();
  });

  it("lets Enter on a focused button click that button instead", () => {
    expect(resolveBillingShortcut(press("Enter"), pay({ focus: "button" }))).toBeNull();
    expect(resolveBillingShortcut(press("F9"), pay({ focus: "button" }))).toBe("confirmPayment");
  });

  it("switches off the bill-screen keys underneath", () => {
    for (const key of ["F6", "F7", "F8"]) {
      expect(resolveBillingShortcut(press(key), pay())).toBeNull();
    }
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true }), pay())).toBeNull();
  });

  it("leaves typed amounts alone", () => {
    for (const key of ["1", ".", "Backspace", "Delete", "Tab"]) {
      expect(resolveBillingShortcut(press(key), pay({ focusedFieldHasText: true }))).toBeNull();
    }
  });
});

describe("resolveBillingShortcut — recovery and help overlays", () => {
  it("closes the recovery window with Esc and blocks the bill screen behind it", () => {
    const recovery = state({ layer: "recovery" });
    expect(resolveBillingShortcut(press("Escape"), recovery)).toBe("closeRecovery");
    expect(resolveBillingShortcut(press("F9"), recovery)).toBeNull();
    expect(resolveBillingShortcut(press("F2"), recovery)).toBeNull();
  });

  it("closes help with Esc or F1 and nothing else", () => {
    const help = state({ layer: "help" });
    expect(resolveBillingShortcut(press("Escape"), help)).toBe("closeHelp");
    expect(resolveBillingShortcut(press("F1"), help)).toBe("toggleHelp");
    expect(resolveBillingShortcut(press("F9"), help)).toBeNull();
    expect(resolveBillingShortcut(press("Enter"), help)).toBeNull();
  });
});

describe("topShortcutLayer", () => {
  it("puts help above modals and modals above the screen", () => {
    expect(topShortcutLayer({ help: false, recovery: false, payment: false })).toBe("screen");
    expect(topShortcutLayer({ help: false, recovery: false, payment: true })).toBe("payment");
    expect(topShortcutLayer({ help: false, recovery: true, payment: true })).toBe("recovery");
    expect(topShortcutLayer({ help: true, recovery: true, payment: true })).toBe("help");
  });

  it("puts a dialog above everything", () => {
    expect(topShortcutLayer({ help: true, recovery: true, payment: true, dialog: true })).toBe("dialog");
    expect(topShortcutLayer({ help: false, recovery: false, payment: true, dialog: true })).toBe("dialog");
    expect(topShortcutLayer({ help: false, recovery: false, payment: false, dialog: false })).toBe("screen");
  });
});

describe("resolveBillingShortcut — dialog layer", () => {
  it("binds nothing, so Enter or F9 in a dialog never confirms payment", () => {
    const dialog = state({ layer: "dialog", focus: "none" });
    for (const key of ["Enter", "F9", "F1", "F2", "F6", "Escape"]) {
      expect(resolveBillingShortcut(press(key), dialog)).toBeNull();
    }
    expect(resolveBillingShortcut(press("Delete", { ctrlKey: true }), dialog)).toBeNull();
  });
});

describe("cycleBillIndex", () => {
  it("wraps at both ends", () => {
    expect(cycleBillIndex(0, 3, 1)).toBe(1);
    expect(cycleBillIndex(2, 3, 1)).toBe(0);
    expect(cycleBillIndex(0, 3, -1)).toBe(2);
    expect(cycleBillIndex(0, 1, 1)).toBe(0);
    expect(cycleBillIndex(0, 0, -1)).toBe(0);
  });
});

describe("BILLING_SHORTCUTS", () => {
  it("resolves every listed binding to its own action, so the help list is truthful", () => {
    for (const b of BILLING_SHORTCUTS) {
      const layer = b.layer === "any" ? "screen" : b.layer;
      expect(resolveBillingShortcut(press(b.key, { ctrlKey: b.ctrl }), state({ layer, focus: "none" }))).toBe(b.action);
    }
  });

  it("has no two bindings fighting over one key in one layer", () => {
    const seen = new Set<string>();
    for (const b of BILLING_SHORTCUTS) {
      const layers = b.layer === "any" ? ["screen", "payment", "recovery", "help", "dialog"] : [b.layer];
      for (const layer of layers) {
        const id = `${layer}:${b.ctrl ? "ctrl+" : ""}${b.key}`;
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
      }
    }
  });

  it("labels keys the way cashiers read them", () => {
    expect(billingShortcutLabel("openPayment")).toBe("F9");
    expect(billingShortcutLabel("removeLastLine")).toBe("Ctrl+Delete");
    expect(billingShortcutLabel("cancelPayment")).toBe("Esc");
    expect(billingShortcutLabel("confirmPayment")).toBe("Enter");
  });
});
