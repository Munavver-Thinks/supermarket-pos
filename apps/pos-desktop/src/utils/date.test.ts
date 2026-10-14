import { describe, expect, it } from "vitest";

import { endOfLocalDay, formatWhen, isoDate, startOfLocalDay } from "./date.js";

describe("date utils", () => {
  it("isoDate pads month and day in local time", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("startOfLocalDay is local midnight of the chosen day", () => {
    expect(startOfLocalDay("2026-03-09")).toBe(new Date(2026, 2, 9, 0, 0, 0, 0).toISOString());
  });

  it("endOfLocalDay is exclusive: local midnight of the day after", () => {
    expect(endOfLocalDay("2026-03-09")).toBe(new Date(2026, 2, 10, 0, 0, 0, 0).toISOString());
    expect(endOfLocalDay("2026-12-31")).toBe(new Date(2027, 0, 1, 0, 0, 0, 0).toISOString());
  });

  it("formatWhen renders an en-IN date and time", () => {
    expect(formatWhen(new Date(2026, 9, 14, 14, 30).toISOString())).toMatch(/14 Oct 2026/);
  });
});
