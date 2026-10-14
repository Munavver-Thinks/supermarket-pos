import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { closeCashSession, getCashTakenSince, getOpenCashSession, openCashSession } from "./cashSessions.js";
import { seedFirstRun } from "./seed.js";

describe("cash sessions", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  const counterId = "counter-1";

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Test Org",
      storeName: "Test Store",
      deviceName: "Register 1",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    userId = seed.ownerUserId;
  });

  afterEach(async () => {
    await db.destroy();
  });

  /** Books a completed sale at the counter with the given payment split. */
  async function recordSale(
    payments: Array<{
      mode: "cash" | "upi";
      amountPaise: number;
      tenderedPaise?: number | null;
      changeAction?: "handback" | "khata" | null;
    }>,
  ): Promise<void> {
    const saleId = randomUUID();
    const total = payments.reduce((sum, p) => sum + p.amountPaise, 0);
    await db
      .insertInto("sales")
      .values({
        id: saleId,
        storeId,
        counterId,
        billNo: `POS-${saleId.slice(0, 6)}`,
        clientTxnId: randomUUID(),
        userId,
        customerId: null,
        status: "completed",
        grossPaise: total,
        discountPaise: 0,
        taxablePaise: total,
        cgstPaise: 0,
        sgstPaise: 0,
        roundOffPaise: 0,
        netPaise: total,
      })
      .execute();

    for (const payment of payments) {
      await db
        .insertInto("payments")
        .values({
          id: randomUUID(),
          saleId,
          mode: payment.mode,
          amountPaise: payment.amountPaise,
          refNo: null,
          tenderedPaise: payment.tenderedPaise ?? null,
          changeAction: payment.changeAction ?? null,
        })
        .execute();
    }
  }

  it("opens a session and finds it as the open one", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 200000 });

    expect(session.openingCashPaise).toBe(200000);
    expect(session.closedAt).toBeNull();
    expect((await getOpenCashSession(db, counterId))?.id).toBe(session.id);
  });

  it("counts only the cash half of a split payment", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 0 });

    await recordSale([{ mode: "cash", amountPaise: 50000 }]);
    await recordSale([
      { mode: "cash", amountPaise: 20000 },
      { mode: "upi", amountPaise: 80000 },
    ]);

    expect(await getCashTakenSince(db, counterId, session.openedAt)).toBe(70000);
  });

  it("counts the full tendered amount as cash taken when change is kept on khata", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 0 });

    // Applied 72000, tendered 75000, change 3000 kept on khata — the drawer physically holds
    // the full 75000, so the expected-cash figure must include the 3000 difference too.
    await recordSale([{ mode: "cash", amountPaise: 72000, tenderedPaise: 75000, changeAction: "khata" }]);

    expect(await getCashTakenSince(db, counterId, session.openedAt)).toBe(75000);
  });

  it("counts only the applied amount as cash taken when change is handed back", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 0 });

    // Tendered 75000, change 3000 handed back — the drawer ends up holding only 72000.
    await recordSale([{ mode: "cash", amountPaise: 72000, tenderedPaise: 75000, changeAction: "handback" }]);

    expect(await getCashTakenSince(db, counterId, session.openedAt)).toBe(72000);
  });

  it("ignores sales from another counter", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 0 });
    await recordSale([{ mode: "cash", amountPaise: 50000 }]);

    expect(await getCashTakenSince(db, "counter-2", session.openedAt)).toBe(0);
  });

  it("returns zero, not NaN, for a session with no sales yet", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 100000 });
    expect(await getCashTakenSince(db, counterId, session.openedAt)).toBe(0);
  });

  it("records a short drawer as a negative variance and closes the session", async () => {
    const session = await openCashSession(db, { storeId, counterId, userId, openingCashPaise: 100000 });

    // Expected 1,500.00 in the drawer, counted 1,480.00 — twenty rupees short.
    const closed = await closeCashSession(db, {
      id: session.id,
      closingCashPaise: 150000,
      countedCashPaise: 148000,
    });

    expect(closed.variancePaise).toBe(-2000);
    expect(closed.closedAt).not.toBeNull();
    expect(await getOpenCashSession(db, counterId)).toBeUndefined();
  });
});
