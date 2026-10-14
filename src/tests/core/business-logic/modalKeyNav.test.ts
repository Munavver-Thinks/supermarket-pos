import { describe, expect, it } from "vitest";

import { cycleFocusIndex, resolveModalNavKey, type ModalNavFocusKind, type ModalNavKeyEvent, type ModalNavMove } from "@/core/business-logic/modalKeyNav.js";

function key(overrides: Partial<ModalNavKeyEvent> & { key: string }): ModalNavKeyEvent {
  return {
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  };
}

const ALL_KINDS: ModalNavFocusKind[] = ["text", "select", "button", "checkbox", "radio", "textarea", "native", "none"];

describe("resolveModalNavKey", () => {
  it("Tab/Shift+Tab resolve to next/prev for every focus kind", () => {
    for (const focus of ALL_KINDS) {
      expect(resolveModalNavKey(key({ key: "Tab" }), focus, true)).toBe("next");
      expect(resolveModalNavKey(key({ key: "Tab", shiftKey: true }), focus, true)).toBe("prev");
      // Also true when arrowNav is false (ShortcutHelpOverlay still gets the Tab trap).
      expect(resolveModalNavKey(key({ key: "Tab" }), focus, false)).toBe("next");
      expect(resolveModalNavKey(key({ key: "Tab", shiftKey: true }), focus, false)).toBe("prev");
    }
  });

  describe("ArrowDown/ArrowUp", () => {
    const yes: ModalNavFocusKind[] = ["text", "select", "button", "checkbox", "none"];
    const no: ModalNavFocusKind[] = ["radio", "textarea", "native"];

    it("moves next/prev for text-like inputs, select, button, checkbox, and nothing focused", () => {
      for (const focus of yes) {
        expect(resolveModalNavKey(key({ key: "ArrowDown" }), focus, true)).toBe("next");
        expect(resolveModalNavKey(key({ key: "ArrowUp" }), focus, true)).toBe("prev");
      }
    });

    it("does nothing for radio, textarea, or native-escape-hatch focus", () => {
      for (const focus of no) {
        expect(resolveModalNavKey(key({ key: "ArrowDown" }), focus, true)).toBeNull();
        expect(resolveModalNavKey(key({ key: "ArrowUp" }), focus, true)).toBeNull();
      }
    });
  });

  describe("ArrowRight/ArrowLeft", () => {
    const yes: ModalNavFocusKind[] = ["button", "checkbox", "none"];
    const no: ModalNavFocusKind[] = ["text", "select", "radio", "textarea", "native"];

    it("moves next/prev only for button, checkbox, and nothing focused", () => {
      for (const focus of yes) {
        expect(resolveModalNavKey(key({ key: "ArrowRight" }), focus, true)).toBe("next");
        expect(resolveModalNavKey(key({ key: "ArrowLeft" }), focus, true)).toBe("prev");
      }
    });

    it("leaves caret movement / native cycling alone for text, select, radio, textarea, native", () => {
      for (const focus of no) {
        expect(resolveModalNavKey(key({ key: "ArrowRight" }), focus, true)).toBeNull();
        expect(resolveModalNavKey(key({ key: "ArrowLeft" }), focus, true)).toBeNull();
      }
    });
  });

  it("Shift+Arrow is always left to native behaviour, for every focus kind", () => {
    for (const focus of ALL_KINDS) {
      for (const arrowKey of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
        expect(resolveModalNavKey(key({ key: arrowKey, shiftKey: true }), focus, true)).toBeNull();
      }
    }
  });

  it("ignores Ctrl, Alt or Meta held with any key", () => {
    for (const mod of ["ctrlKey", "altKey", "metaKey"] as const) {
      expect(resolveModalNavKey(key({ key: "Tab", [mod]: true }), "text", true)).toBeNull();
      expect(resolveModalNavKey(key({ key: "ArrowDown", [mod]: true }), "text", true)).toBeNull();
    }
  });

  it("ignores a key mid-IME composition", () => {
    expect(resolveModalNavKey(key({ key: "Tab", isComposing: true }), "text", true)).toBeNull();
    expect(resolveModalNavKey(key({ key: "ArrowDown", isComposing: true }), "text", true)).toBeNull();
  });

  it("ignores a key another listener already handled", () => {
    expect(resolveModalNavKey(key({ key: "Tab", defaultPrevented: true }), "text", true)).toBeNull();
    expect(resolveModalNavKey(key({ key: "ArrowDown", defaultPrevented: true }), "text", true)).toBeNull();
  });

  it("arrowNav: false resolves only Tab/Shift+Tab, nothing else", () => {
    for (const focus of ALL_KINDS) {
      expect(resolveModalNavKey(key({ key: "ArrowDown" }), focus, false)).toBeNull();
      expect(resolveModalNavKey(key({ key: "ArrowUp" }), focus, false)).toBeNull();
      expect(resolveModalNavKey(key({ key: "ArrowLeft" }), focus, false)).toBeNull();
      expect(resolveModalNavKey(key({ key: "ArrowRight" }), focus, false)).toBeNull();
    }
  });

  it("does nothing for an unrelated key", () => {
    expect(resolveModalNavKey(key({ key: "Enter" }), "text", true)).toBeNull();
    expect(resolveModalNavKey(key({ key: "Escape" }), "button", true)).toBeNull();
    expect(resolveModalNavKey(key({ key: "a" }), "text", true)).toBeNull();
  });
});

describe("cycleFocusIndex", () => {
  it("wraps forward past the last index", () => {
    expect(cycleFocusIndex(2, 3, "next")).toBe(0);
  });

  it("wraps backward past the first index", () => {
    expect(cycleFocusIndex(0, 3, "prev")).toBe(2);
  });

  it("moves by one in the middle", () => {
    expect(cycleFocusIndex(1, 3, "next")).toBe(2);
    expect(cycleFocusIndex(1, 3, "prev")).toBe(0);
  });

  it("starts at the first element for next when focus is outside the container", () => {
    expect(cycleFocusIndex(-1, 3, "next" as ModalNavMove)).toBe(0);
  });

  it("starts at the last element for prev when focus is outside the container", () => {
    expect(cycleFocusIndex(-1, 3, "prev" as ModalNavMove)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(cycleFocusIndex(-1, 0, "next")).toBe(0);
    expect(cycleFocusIndex(0, 0, "prev")).toBe(0);
  });
});
