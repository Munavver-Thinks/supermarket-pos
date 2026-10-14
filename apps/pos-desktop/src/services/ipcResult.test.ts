import { describe, expect, it } from "vitest";

import { isDenied } from "./ipcResult.js";

describe("isDenied", () => {
  it("is true only for an { ok: false } refusal", () => {
    expect(isDenied({ ok: false, error: "no" })).toBe(true);
    expect(isDenied({ ok: true })).toBe(false);
    expect(isDenied([])).toBe(false);
    expect(isDenied(null)).toBe(false);
    expect(isDenied(0)).toBe(false);
    expect(isDenied({ rows: [] })).toBe(false);
  });
});
