import { describe, expect, it } from "vitest";

import { parseNonNegativeRupees, parsePositiveRupeesOrNull, parseRupeesOrZero, parseRupeesStrict } from "./money.js";

// The expressions the screens used before these helpers existed, kept verbatim as the oracle.
const oldOrZero = (x: string): number => Math.round((Number(x) || 0) * 100);
const oldStrict = (x: string): number => Math.round(Number(x) * 100);
const oldNonNegative = (text: string): number | null => {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
};
const oldPositiveOrNull = (x: string): number | null => {
  const paise = Math.round(Number(x) * 100);
  return paise > 0 ? paise : null;
};

const INPUTS = ["", " ", "abc", "-5", "0", "0.00", "12", "12.5", "12.345", "10.005", " 12 ", "1e3", "Infinity", "-0", "0.1", "1.005"];

describe("money parsers match the original inline expressions", () => {
  it.each(INPUTS)("parseRupeesOrZero(%j)", (x) => {
    expect(Object.is(parseRupeesOrZero(x), oldOrZero(x))).toBe(true);
  });
  it.each(INPUTS)("parseRupeesStrict(%j)", (x) => {
    expect(Object.is(parseRupeesStrict(x), oldStrict(x))).toBe(true);
  });
  it.each(INPUTS)("parseNonNegativeRupees(%j)", (x) => {
    expect(parseNonNegativeRupees(x)).toBe(oldNonNegative(x));
  });
  it.each(INPUTS)("parsePositiveRupeesOrNull(%j)", (x) => {
    expect(parsePositiveRupeesOrNull(x)).toBe(oldPositiveOrNull(x));
  });
});

describe("what an invalid box becomes", () => {
  it("is 0 for the lenient parser, NaN for the strict one, null for the guarded ones", () => {
    expect(parseRupeesOrZero("abc")).toBe(0);
    expect(parseRupeesStrict("abc")).toBeNaN();
    expect(parseNonNegativeRupees("abc")).toBeNull();
    expect(parsePositiveRupeesOrNull("abc")).toBeNull();
  });
  it("keeps 0 as a valid amount only where that is allowed", () => {
    expect(parseNonNegativeRupees("0")).toBe(0);
    expect(parsePositiveRupeesOrNull("0")).toBeNull();
  });
});
