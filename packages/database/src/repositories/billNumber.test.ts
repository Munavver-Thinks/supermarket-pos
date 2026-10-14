import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { getIndianFinancialYear, nextBillNumber, nextDailyBillNumber } from "./billNumber.js";

describe("nextDailyBillNumber — sale bills, reset every day", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("starts at 1 and counts up within the same day", async () => {
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05")).toBe("POS-20261005-1");
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05")).toBe("POS-20261005-2");
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05")).toBe("POS-20261005-3");
  });

  it("resets to 1 the moment the date changes, even mid-sequence", async () => {
    await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05");
    await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05");
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-06")).toBe("POS-20261006-1");
  });

  it("keeps each counter's own count, even on the same day", async () => {
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05")).toBe("POS-20261005-1");
    expect(await nextDailyBillNumber(db, "counter-2", "POS", "2026-10-05")).toBe("POS-20261005-1");
    expect(await nextDailyBillNumber(db, "counter-1", "POS", "2026-10-05")).toBe("POS-20261005-2");
  });

  it("falls back to the server's own local day when the caller passes none", async () => {
    const billNo = await nextDailyBillNumber(db, "counter-1", "POS");
    expect(billNo).toMatch(/^POS-\d{8}-1$/);
  });

  it("never collides with the financial-year sequence sharing the same table", async () => {
    // A real shop never does this (returns.ts/purchaseOrders.ts key their own counterId
    // namespace), but the two schemes sharing one table must still never cross-count.
    await nextBillNumber(db, "shared-key", "POS");
    expect(await nextDailyBillNumber(db, "shared-key", "POS", "2026-10-05")).toBe("POS-20261005-1");
  });
});

describe("nextBillNumber — returns and purchase orders, unchanged financial-year scheme", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("is gap-free, zero-padded to 6 digits, and never resets within the financial year", async () => {
    const first = await nextBillNumber(db, "return:counter-1", "RET");
    const second = await nextBillNumber(db, "return:counter-1", "RET");
    const fy = getIndianFinancialYear(new Date());
    expect(first).toBe(`RET/${fy}/000001`);
    expect(second).toBe(`RET/${fy}/000002`);
  });
});

describe("getIndianFinancialYear", () => {
  it("starts the year on 1 April", () => {
    expect(getIndianFinancialYear(new Date(Date.UTC(2026, 2, 31)))).toBe("2025-26"); // 31 Mar
    expect(getIndianFinancialYear(new Date(Date.UTC(2026, 3, 1)))).toBe("2026-27"); // 1 Apr
  });
});
