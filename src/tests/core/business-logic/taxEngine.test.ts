import { describe, expect, it } from "vitest";

import { computeLineTax } from "@/core/business-logic/taxEngine.js";

describe("computeLineTax", () => {
  it("splits a tax-inclusive line into taxable + CGST/SGST", () => {
    // 1 unit at ₹118 inclusive, 18% GST => 100 taxable, 9 CGST, 9 SGST
    const result = computeLineTax({
      netUnitPricePaise: 11800,
      qty: 1,
      isTaxInclusive: true,
      taxRatePercent: 18,
    });
    expect(result.grossLinePaise).toBe(11800);
    expect(result.taxablePaise).toBe(10000);
    expect(result.cgstPaise).toBe(900);
    expect(result.sgstPaise).toBe(900);
    expect(result.totalPaise).toBe(11800);
  });

  it("adds tax on top for a tax-exclusive line (wholesale case)", () => {
    const result = computeLineTax({
      netUnitPricePaise: 10000,
      qty: 1,
      isTaxInclusive: false,
      taxRatePercent: 18,
    });
    expect(result.taxablePaise).toBe(10000);
    expect(result.cgstPaise).toBe(900);
    expect(result.sgstPaise).toBe(900);
    expect(result.totalPaise).toBe(11800);
  });

  it("handles zero-rated (0% GST) items", () => {
    const result = computeLineTax({
      netUnitPricePaise: 5000,
      qty: 2,
      isTaxInclusive: true,
      taxRatePercent: 0,
    });
    expect(result.grossLinePaise).toBe(10000);
    expect(result.taxablePaise).toBe(10000);
    expect(result.cgstPaise).toBe(0);
    expect(result.sgstPaise).toBe(0);
  });

  it("splits an odd total tax paisa without losing a paisa (rounding edge case)", () => {
    // 1 unit at ₹100.01 inclusive, 5% GST => total tax = 476 paise (odd) => 238/238
    const result = computeLineTax({
      netUnitPricePaise: 10001,
      qty: 1,
      isTaxInclusive: true,
      taxRatePercent: 5,
    });
    expect(result.cgstPaise + result.sgstPaise).toBe(result.grossLinePaise - result.taxablePaise);
  });

  it("scales correctly across a fractional (weighted) quantity", () => {
    // 1.85 kg at ₹60/kg tax-exclusive, 0% GST => ₹111
    const result = computeLineTax({
      netUnitPricePaise: 6000,
      qty: 1.85,
      isTaxInclusive: false,
      taxRatePercent: 0,
    });
    expect(result.grossLinePaise).toBe(11100);
    expect(result.totalPaise).toBe(11100);
  });
});
