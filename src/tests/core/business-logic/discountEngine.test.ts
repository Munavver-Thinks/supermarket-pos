import { describe, expect, it } from "vitest";

import { applyBillDiscount, applyLineDiscount, BelowCostDiscountError, parseDiscountInput } from "@/core/business-logic/discountEngine.js";

describe("applyLineDiscount", () => {
  it("applies a flat + percent discount together", () => {
    const result = applyLineDiscount({
      unitPricePaise: 10000,
      qty: 2,
      discountPercent: 10,
      discountFlatPaise: 100,
      costPricePaise: 5000,
      allowBelowCost: false,
    });
    // gross = 20000, percent discount = 2000, + 100 flat = 2100
    expect(result.grossPaise).toBe(20000);
    expect(result.discountPaise).toBe(2100);
    expect(result.netUnitPricePaise).toBe(8950);
  });

  it("never discounts below zero", () => {
    const result = applyLineDiscount({
      unitPricePaise: 100,
      qty: 1,
      discountPercent: 100,
      discountFlatPaise: 500,
      costPricePaise: 0,
      allowBelowCost: true,
    });
    expect(result.discountPaise).toBe(100);
    expect(result.netUnitPricePaise).toBe(0);
  });

  it("blocks a discount that would price the line below cost", () => {
    expect(() =>
      applyLineDiscount({
        unitPricePaise: 100,
        qty: 1,
        discountPercent: 50,
        discountFlatPaise: 0,
        costPricePaise: 90,
        allowBelowCost: false,
      }),
    ).toThrow(BelowCostDiscountError);
  });

  it("allows a below-cost discount when explicitly overridden (manager approval)", () => {
    const result = applyLineDiscount({
      unitPricePaise: 100,
      qty: 1,
      discountPercent: 50,
      discountFlatPaise: 0,
      costPricePaise: 90,
      allowBelowCost: true,
    });
    expect(result.netUnitPricePaise).toBe(50);
  });
});

describe("parseDiscountInput", () => {
  it("reads a trailing percent sign as a rate", () => {
    expect(parseDiscountInput("10%")).toEqual({ discountPercent: 10, discountFlatPaise: 0 });
    expect(parseDiscountInput("7.5 %")).toEqual({ discountPercent: 7.5, discountFlatPaise: 0 });
  });

  it("reads a bare or rupee-marked number as a flat amount", () => {
    expect(parseDiscountInput("5")).toEqual({ discountPercent: 0, discountFlatPaise: 500 });
    expect(parseDiscountInput("₹5")).toEqual({ discountPercent: 0, discountFlatPaise: 500 });
    expect(parseDiscountInput("rs 5")).toEqual({ discountPercent: 0, discountFlatPaise: 500 });
    expect(parseDiscountInput("2.50")).toEqual({ discountPercent: 0, discountFlatPaise: 250 });
  });

  it("treats empty input as clearing the discount", () => {
    expect(parseDiscountInput("")).toEqual({ discountPercent: 0, discountFlatPaise: 0 });
    expect(parseDiscountInput("   ")).toEqual({ discountPercent: 0, discountFlatPaise: 0 });
  });

  it("rejects input that is not a usable discount", () => {
    // Each of these would otherwise read as "no discount", which looks on screen exactly
    // like a discount the cashier thinks they just applied.
    expect(parseDiscountInput("abc")).toBeNull();
    expect(parseDiscountInput("-5")).toBeNull();
    expect(parseDiscountInput("120%")).toBeNull();
    expect(parseDiscountInput("10%%")).toBeNull();
    expect(parseDiscountInput("5 off")).toBeNull();
  });
});

describe("applyBillDiscount", () => {
  it("caps the discount at the subtotal", () => {
    expect(applyBillDiscount({ subtotalPaise: 1000, billDiscountPercent: 0, billDiscountFlatPaise: 5000 })).toBe(
      1000,
    );
  });

  it("combines percent and flat", () => {
    expect(applyBillDiscount({ subtotalPaise: 10000, billDiscountPercent: 5, billDiscountFlatPaise: 100 })).toBe(
      600,
    );
  });
});
