import { describe, expect, it } from "vitest";

import {
  addDaysIso,
  BLOCK_EXPIRED_SALE_KEY,
  classifyExpiry,
  EXPIRY_ALERT_DAYS,
  ExpiredStockError,
  findExpiredStockConflicts,
  localDateIso,
  parseBlockExpiredSale,
} from "@/core/business-logic/expiryPolicy.js";

describe("parseBlockExpiredSale", () => {
  it("is off unless explicitly switched on", () => {
    expect(BLOCK_EXPIRED_SALE_KEY).toBe("stock.blockExpiredSale");
    expect(parseBlockExpiredSale("true")).toBe(true);
    expect(parseBlockExpiredSale("false")).toBe(false);
    expect(parseBlockExpiredSale(undefined)).toBe(false);
    expect(parseBlockExpiredSale(null)).toBe(false);
    expect(parseBlockExpiredSale("TRUE")).toBe(false);
  });
});

describe("dates", () => {
  it("formats the local calendar day", () => {
    expect(localDateIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("adds days across month and year ends", () => {
    expect(addDaysIso("2026-12-20", 15)).toBe("2027-01-04");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("classifyExpiry", () => {
  const today = "2026-09-16";

  it("treats the expiry date itself as still sellable", () => {
    expect(classifyExpiry("2026-09-16", today, EXPIRY_ALERT_DAYS)).toBe("expiring");
    expect(classifyExpiry("2026-09-15", today, EXPIRY_ALERT_DAYS)).toBe("expired");
  });

  it("flags a batch inside the alert window and not one beyond it", () => {
    expect(classifyExpiry("2026-10-01", today, 30)).toBe("expiring");
    expect(classifyExpiry("2026-10-16", today, 30)).toBe("expiring");
    expect(classifyExpiry("2026-10-17", today, 30)).toBe("ok");
  });

  it("treats a batch with no date as fine", () => {
    expect(classifyExpiry(null, today, 30)).toBe("ok");
  });
});

describe("findExpiredStockConflicts", () => {
  it("refuses only what cannot come from in-date stock", () => {
    // 5 on hand, 3 expired → 2 are sellable.
    expect(findExpiredStockConflicts([{ productId: "p1", name: "Toor Dal", qty: 2 }], { p1: 5 }, { p1: 3 })).toEqual([]);
    expect(findExpiredStockConflicts([{ productId: "p1", name: "Toor Dal", qty: 3 }], { p1: 5 }, { p1: 3 })).toEqual([
      { productId: "p1", name: "Toor Dal", requestedQty: 3, onHandQty: 5, expiredQty: 3 },
    ]);
  });

  it("never conflicts when nothing is expired, even past on-hand", () => {
    // Going below zero is the negative-stock policy's call, not this one's.
    expect(findExpiredStockConflicts([{ productId: "p1", name: "Rice", qty: 50 }], { p1: 5 }, {})).toEqual([]);
  });

  it("sums the same product across lines", () => {
    const conflicts = findExpiredStockConflicts(
      [
        { productId: "p1", name: "Milk", qty: 1 },
        { productId: "p1", name: "Milk", qty: 1 },
      ],
      { p1: 2 },
      { p1: 1 },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.requestedQty).toBe(2);
  });

  it("ignores floating-point drift on weighed goods", () => {
    expect(
      findExpiredStockConflicts(
        [
          { productId: "p1", name: "Tomato", qty: 1.1 },
          { productId: "p1", name: "Tomato", qty: 0.2 },
        ],
        { p1: 1.8 },
        { p1: 0.5 },
      ),
    ).toEqual([]);
  });

  it("names each item in the error", () => {
    const error = new ExpiredStockError([
      { productId: "p1", name: "Toor Dal", requestedQty: 3, onHandQty: 5, expiredQty: 3 },
    ]);
    expect(error.message).toBe("Toor Dal: 3 of 5 on hand are past expiry — write them off in Inventory before selling.");
    expect(error.name).toBe("ExpiredStockError");
  });
});
