import { describe, expect, it } from "vitest";

import { shouldAutoReload } from "@/core/business-logic/crashLoopGuard.js";

const MIN = 60_000;

describe("shouldAutoReload", () => {
  it("reloads the first three crashes and asks on the fourth within five minutes", () => {
    const now = 10 * MIN;
    expect(shouldAutoReload([], now)).toBe(true);
    expect(shouldAutoReload([now - MIN], now)).toBe(true);
    expect(shouldAutoReload([now - 2 * MIN, now - MIN], now)).toBe(true);
    expect(shouldAutoReload([now - 3 * MIN, now - 2 * MIN, now - MIN], now)).toBe(false);
  });

  it("forgets crashes older than the window", () => {
    const now = 20 * MIN;
    expect(shouldAutoReload([now - 9 * MIN, now - 8 * MIN, now - 6 * MIN], now)).toBe(true);
    expect(shouldAutoReload([now - 5 * MIN, now - 2 * MIN, now - MIN], now)).toBe(true);
    expect(shouldAutoReload([now - 5 * MIN + 1, now - 2 * MIN, now - MIN], now)).toBe(false);
  });

  it("honours custom limits", () => {
    expect(shouldAutoReload([1000], 2000, { max: 1, windowMs: 5000 })).toBe(false);
    expect(shouldAutoReload([1000], 7000, { max: 1, windowMs: 5000 })).toBe(true);
  });

  it("ignores timestamps from the future (a clock change)", () => {
    expect(shouldAutoReload([5000, 6000, 7000], 1000)).toBe(true);
  });
});
