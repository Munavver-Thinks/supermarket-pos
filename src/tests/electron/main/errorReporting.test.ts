import { describe, expect, it, vi } from "vitest";

import { createRendererErrorLimiter, reportError } from "../../../../electron/main/errorReporting.js";

describe("createRendererErrorLimiter", () => {
  it("stores up to 20 errors a minute, then hands back the last id without storing", () => {
    let t = 0;
    const limit = createRendererErrorLimiter(20, 60_000, () => t);
    let n = 0;
    const report = vi.fn(() => `id-${++n}`);

    for (let i = 0; i < 20; i++) {
      expect(limit(report)).toEqual({ errorId: `id-${i + 1}`, stored: true });
    }
    expect(limit(report)).toEqual({ errorId: "id-20", stored: false });
    expect(limit(report)).toEqual({ errorId: "id-20", stored: false });
    expect(report).toHaveBeenCalledTimes(20);

    // A minute after the first, room opens up again.
    t = 60_000;
    expect(limit(report)).toEqual({ errorId: "id-21", stored: true });
  });

  it("keeps a sliding window", () => {
    let t = 0;
    const limit = createRendererErrorLimiter(2, 1000, () => t);
    let n = 0;
    const report = () => `id-${++n}`;
    limit(report); // t=0
    t = 500;
    limit(report); // t=500
    t = 999;
    expect(limit(report).stored).toBe(false);
    t = 1000; // the first has aged out, the second hasn't
    expect(limit(report).stored).toBe(true);
    t = 1200;
    expect(limit(report).stored).toBe(false);
  });
});

describe("reportError", () => {
  it("returns a reference id and never throws, even without a database", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const id = reportError(undefined, { storeId: null, userId: null, context: "test" }, new Error("boom"));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    spy.mockRestore();
  });
});
