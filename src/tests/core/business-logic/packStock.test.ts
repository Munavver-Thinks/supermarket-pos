import { describe, expect, it } from "vitest";

import { formatPackBreakdown, formatStockBreakdown, sumPackStock, totalStockQty } from "@/core/business-logic/packStock.js";

describe("formatPackBreakdown", () => {
  it("lists loose stock and each pack size on hand", () => {
    expect(
      formatPackBreakdown(20, "kg", [
        { name: "Sugar 1kg", qtyOnHand: 10 },
        { name: "Sugar 500g", qtyOnHand: 4 },
      ]),
    ).toBe("20 kg loose · 10 × Sugar 1kg · 4 × Sugar 500g");
  });

  it("skips packs with nothing on hand", () => {
    expect(
      formatPackBreakdown(2.5, "kg", [
        { name: "Sugar 1kg", qtyOnHand: 0 },
        { name: "Sugar 500g", qtyOnHand: 4 },
      ]),
    ).toBe("2.5 kg loose · 4 × Sugar 500g");
  });

  it("says so when every pack is at zero", () => {
    expect(formatPackBreakdown(20, "kg", [{ name: "Sugar 1kg", qtyOnHand: 0 }])).toBe("20 kg loose · no packs on hand");
  });
});

describe("sumPackStock", () => {
  it("is 0 for an empty child list", () => {
    expect(sumPackStock([])).toBe(0);
  });

  it("sums qtyOnHand × packQty across children", () => {
    expect(
      sumPackStock([
        { qtyOnHand: 3, packQty: 0.5 },
        { qtyOnHand: 20, packQty: 1 },
      ]),
    ).toBe(21.5);
  });

  it("subtracts a negative child quantity rather than clamping it", () => {
    expect(
      sumPackStock([
        { qtyOnHand: 20, packQty: 1 },
        { qtyOnHand: -5, packQty: 1 },
      ]),
    ).toBe(15);
  });
});

describe("totalStockQty", () => {
  it("is just the own qty when there are no pack sizes", () => {
    expect(totalStockQty(30, null)).toBe(30);
  });

  it("adds the pack stock when there is some", () => {
    expect(totalStockQty(30, 20)).toBe(50);
  });
});

describe("formatStockBreakdown", () => {
  it("shows just the own qty when there are no pack sizes", () => {
    expect(formatStockBreakdown(30, null, "kg")).toBe("30 kg");
  });

  it("shows the total plus the loose/packed split when there are pack sizes", () => {
    expect(formatStockBreakdown(30, 20, "kg")).toBe("50 kg (30 kg loose + 20 kg in packs)");
  });
});
