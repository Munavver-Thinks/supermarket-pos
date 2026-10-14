import { randomUUID } from "node:crypto";

import { computeCartTotals } from "@pos/business-logic";
import { createDb, runMigrations, salesRepo, seedRepo, usersRepo, type Db } from "@pos/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pdfFileName, printSaleDocument } from "./salePrint.js";

describe("pdfFileName", () => {
  it("turns a bill number into a safe file name", () => {
    expect(pdfFileName("POS/2026-27/000042")).toBe("POS_2026-27_000042.pdf");
    expect(pdfFileName('..\\x:y*"z')).toBe(".._x_y_z.pdf");
    expect(pdfFileName("///")).toBe("invoice.pdf");
  });
});

describe("printSaleDocument", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let saleId: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedRepo.seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    storeId = seed.storeId;
    userId = seed.ownerUserId;

    const productId = randomUUID();
    await db
      .insertInto("products")
      .values({ id: productId, storeId, name: "Salt", uom: "pcs", isWeighted: 0, taxRatePercent: 0, isActive: 1 })
      .execute();
    const cart = {
      clientTxnId: randomUUID(),
      storeId,
      counterId: "counter-1",
      userId,
      customerId: null,
      billDiscountPercent: 0,
      billDiscountFlatPaise: 0,
      heldAt: null,
      lines: [
        {
          lineId: randomUUID(),
          productId,
          name: "Salt",
          uom: "pcs",
          qty: 1,
          unitPricePaise: 2000,
          isTaxInclusive: true,
          taxRatePercent: 0,
          discountPercent: 0,
          discountFlatPaise: 0,
        },
      ],
    };
    const computed = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
    const { sale } = await salesRepo.createSale(db, {
      storeId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      userId,
      customerId: null,
      clientTxnId: cart.clientTxnId,
      lines: computed.lines,
      totals: computed.totals,
      payments: [{ mode: "cash", amountPaise: computed.totals.netPaise, refNo: null }],
    });
    saleId = sale.id;
  });

  afterEach(async () => {
    await db.destroy();
  });

  const run = (
    format: "receipt" | "a4" | "pdf",
    output: Parameters<typeof printSaleDocument>[2],
    actingUserId = userId,
  ) => printSaleDocument(db, { storeId, deviceId: "d1", saleId, actingUserId, format }, output, () => undefined);

  async function reprintAudits() {
    return db.selectFrom("auditLogs").selectAll().where("action", "=", "receipt_reprinted").execute();
  }

  it("prints the first copy unmarked and every later copy as a duplicate, whatever the screen wants", async () => {
    const seen: boolean[] = [];
    const output = vi.fn(async (_data, duplicate: boolean) => {
      seen.push(duplicate);
      return { ok: true };
    });

    expect(await run("receipt", output)).toMatchObject({ ok: true, duplicate: false });
    expect(await run("receipt", output)).toMatchObject({ ok: true, duplicate: true });
    expect(await run("a4", output)).toMatchObject({ ok: true, duplicate: true });
    expect(seen).toEqual([false, true, true]);
    expect(await reprintAudits()).toHaveLength(2);
  });

  it("records nothing when the printer fails, so the next copy is still the original", async () => {
    const failed = await run("receipt", async () => ({ ok: false, error: "Printer offline" }));
    expect(failed).toEqual({ ok: false, error: "Printer offline", duplicate: false });

    const thrown = await run("receipt", async () => {
      throw new Error("driver crashed");
    });
    expect(thrown).toMatchObject({ ok: false, error: "driver crashed" });

    expect(await db.selectFrom("receiptPrints").selectAll().execute()).toHaveLength(0);
    expect(await run("receipt", async () => ({ ok: true }))).toMatchObject({ duplicate: false });
  });

  it("passes a saved PDF's path back", async () => {
    expect(await run("pdf", async () => ({ ok: true, path: "C:\\bills\\x.pdf" }))).toEqual({
      ok: true,
      path: "C:\\bills\\x.pdf",
      duplicate: false,
    });
  });

  it("refuses an inactive user or a bill from another store without printing", async () => {
    const output = vi.fn(async () => ({ ok: true }));
    await usersRepo.setUserActive(db, userId, false);
    expect(await run("receipt", output)).toMatchObject({ ok: false });

    await usersRepo.setUserActive(db, userId, true);
    const other = await printSaleDocument(
      db,
      { storeId: randomUUID(), deviceId: null, saleId, actingUserId: userId, format: "receipt" },
      output,
      () => undefined,
    );
    expect(other.ok).toBe(false);

    const missing = await printSaleDocument(
      db,
      { storeId, deviceId: null, saleId: randomUUID(), actingUserId: userId, format: "receipt" },
      output,
      () => undefined,
    );
    expect(missing).toEqual({ ok: false, error: "That bill could not be found." });
    expect(output).not.toHaveBeenCalled();
  });
});
