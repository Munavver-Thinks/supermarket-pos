import { randomUUID } from "node:crypto";

import { computePurchaseTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { getLowStock, getPackStockByParent, getStock, recordStockAdjustment, setReorderLevel } from "./inventory.js";
import { createChildProduct } from "./productPacks.js";
import { changeProductPrices, createProduct, listProductsForAdmin, setProductActive } from "./productsAdmin.js";
import { createPurchase } from "./purchases.js";
import { RepackError, repackStock } from "./repack.js";
import { seedFirstRun } from "./seed.js";
import { listForProduct } from "./stockBatches.js";
import { createSupplier } from "./suppliers.js";

const TODAY = "2026-10-01";

describe("repack", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let supplierId: string;
  let parentId: string;
  let childId: string;

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
    supplierId = (
      await createSupplier(db, storeId, { name: "Balaji", phone: null, email: null, address: null, gstin: null, notes: null })
    ).id;

    parentId = await createProduct(db, {
      storeId,
      name: "Sugar 50kg Bag",
      nameTamil: null,
      shortCode: null,
      uom: "kg",
      isWeighted: true,
      hsnCode: "1701",
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 6500,
      salePricePaise: 6000,
      costPricePaise: 5000,
      isTaxInclusive: true,
    });

    childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function receive(lines: Array<{ qty: number; expiryDate?: string }>) {
    const { lines: computed, totals } = computePurchaseTotals(
      lines.map((l) => ({ productId: parentId, costPricePaise: 5000, taxRatePercent: 0, isTaxInclusive: false, ...l })),
    );
    return createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: `INV-${randomUUID().slice(0, 8)}`,
      invoiceDate: TODAY,
      notes: null,
      userId,
      lines: computed,
      totals,
      updateCostPrice: false,
    });
  }

  it("moves stock from the parent into the child, with the source batch's expiry carried over", async () => {
    await receive([{ qty: 50, expiryDate: "2027-01-01" }]);

    const result = await repackStock(db, {
      storeId,
      parentProductId: parentId,
      childProductId: childId,
      childQty: 20,
      userId,
      deviceId: "device-1",
      today: TODAY, packedOn: TODAY, expiryDate: null,
    });

    expect(result).toMatchObject({ parentQtyOnHandAfter: 30, childQtyOnHandAfter: 20, parentQtyUsed: 20 });
    expect(await getStock(db, storeId, parentId)).toBe(30);
    expect(await getStock(db, storeId, childId)).toBe(20);

    const childBatches = await listForProduct(db, storeId, childId);
    expect(childBatches).toHaveLength(1);
    expect(childBatches[0]).toMatchObject({ expiryDate: "2027-01-01", qtyRemaining: 20, costPricePaise: 5000 });

    const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "stock_repacked" });
    expect(entry?.recordId).toBe(childId);
    expect(entry?.newValue).toMatchObject({ parentQtyUsed: 20, childQtyMade: 20 });
  });

  it("splits across two batches with different expiries into two correctly-dated child batches", async () => {
    await receive([{ qty: 10, expiryDate: "2026-11-01" }]);
    await receive([{ qty: 10, expiryDate: "2027-02-01" }]);

    // 15 packs of 1kg needs all 10kg of the earlier batch, then 5kg of the later one.
    await repackStock(db, {
      storeId,
      parentProductId: parentId,
      childProductId: childId,
      childQty: 15,
      userId,
      deviceId: null,
      today: TODAY, packedOn: TODAY, expiryDate: null,
    });

    const childBatches = (await listForProduct(db, storeId, childId)).sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""));
    expect(childBatches).toMatchObject([
      { expiryDate: "2026-11-01", qtyRemaining: 10 },
      { expiryDate: "2027-02-01", qtyRemaining: 5 },
    ]);
  });

  it("refuses to repack from stock that has already expired", async () => {
    await receive([{ qty: 10, expiryDate: "2026-01-01" }]); // expired relative to TODAY

    await expect(
      repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 5,
        userId,
        deviceId: null,
        today: TODAY, packedOn: TODAY, expiryDate: null,
      }),
    ).rejects.toThrow(RepackError);

    // Nothing moved — the whole attempt rolled back.
    expect(await getStock(db, storeId, parentId)).toBe(10);
    expect(await getStock(db, storeId, childId)).toBe(0);
  });

  it("refuses when the parent simply doesn't have enough stock", async () => {
    await receive([{ qty: 5, expiryDate: "2027-01-01" }]);
    await expect(
      repackStock(db, { storeId, parentProductId: parentId, childProductId: childId, childQty: 10, userId, deviceId: null, today: TODAY, packedOn: TODAY, expiryDate: null }),
    ).rejects.toThrow(RepackError);
  });

  it("refuses a child that doesn't belong to this parent", async () => {
    const otherParent = await createProduct(db, {
      storeId,
      name: "Rice 50kg Bag",
      nameTamil: null,
      shortCode: null,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4500,
      costPricePaise: 4000,
      isTaxInclusive: true,
    });
    await receive([{ qty: 10, expiryDate: "2027-01-01" }]);
    await expect(
      repackStock(db, { storeId, parentProductId: otherParent, childProductId: childId, childQty: 1, userId, deviceId: null, today: TODAY, packedOn: TODAY, expiryDate: null }),
    ).rejects.toThrow(RepackError);
  });

  it("uses the child's own current cost price for the new batch, not the parent's", async () => {
    await changeProductPrices(db, childId, { mrpPaise: 7500, salePricePaise: 7000, costPricePaise: 5800, isTaxInclusive: true }, {
      storeId,
      userId,
      deviceId: null,
    });
    await receive([{ qty: 10, expiryDate: "2027-01-01" }]);
    await repackStock(db, { storeId, parentProductId: parentId, childProductId: childId, childQty: 5, userId, deviceId: null, today: TODAY, packedOn: TODAY, expiryDate: null });

    const [batch] = await listForProduct(db, storeId, childId);
    expect(batch?.costPricePaise).toBe(5800);
  });

  it("uses the child's own current MRP for the new batch, not the parent's", async () => {
    await changeProductPrices(
      db,
      childId,
      { mrpPaise: 7500, salePricePaise: 7000, costPricePaise: 5800, isTaxInclusive: true },
      { storeId, userId, deviceId: null },
    );
    await receive([{ qty: 10, expiryDate: "2027-01-01" }]);
    await repackStock(db, { storeId, parentProductId: parentId, childProductId: childId, childQty: 5, userId, deviceId: null, today: TODAY, packedOn: TODAY, expiryDate: null });

    const [batch] = await listForProduct(db, storeId, childId);
    // The parent's own MRP is 6500 (set in beforeEach) — the child's batch must not inherit it.
    expect(batch?.mrpPaise).toBe(7500);
  });

  describe("traceability", () => {
    const base = () => ({
      storeId,
      parentProductId: parentId,
      childProductId: childId,
      userId,
      deviceId: null,
      today: TODAY,
    });

    it("records the repack, its sources and a batch number on every child batch", async () => {
      await receive([{ qty: 10, expiryDate: "2026-11-01" }]);
      await receive([{ qty: 10, expiryDate: "2027-02-01" }]);

      const result = await repackStock(db, { ...base(), childQty: 15, packedOn: "2026-09-30", expiryDate: null });
      expect(result.batchNo).toBe("RP-20260930-1");

      const repack = await db.selectFrom("repacks").selectAll().where("id", "=", result.repackId).executeTakeFirstOrThrow();
      expect(repack).toMatchObject({
        parentProductId: parentId,
        childProductId: childId,
        childQty: 15,
        parentQtyUsed: 15,
        batchNo: "RP-20260930-1",
        packedOn: "2026-09-30",
        expiryDate: "2026-11-01",
        userId,
      });

      const sources = await db.selectFrom("repackSources").selectAll().where("repackId", "=", result.repackId).execute();
      expect(sources.map((s) => ({ qty: s.qty, expiryDate: s.expiryDate })).sort((a, b) => a.qty - b.qty)).toEqual([
        { qty: 5, expiryDate: "2027-02-01" },
        { qty: 10, expiryDate: "2026-11-01" },
      ]);
      expect(sources.every((s) => s.parentBatchId !== null)).toBe(true);

      const childBatches = await listForProduct(db, storeId, childId);
      expect(childBatches).toHaveLength(2);
      for (const batch of childBatches) {
        expect(batch).toMatchObject({ batchNo: "RP-20260930-1", packedOn: "2026-09-30", repackId: result.repackId });
      }

      const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "stock_repacked" });
      expect(entry?.newValue).toMatchObject({ batchNo: "RP-20260930-1", packedOn: "2026-09-30", expiryDate: "2026-11-01" });
    });

    it("numbers batches per packed-on date", async () => {
      await receive([{ qty: 50, expiryDate: "2027-01-01" }]);
      const a = await repackStock(db, { ...base(), childQty: 1, packedOn: "2026-10-01", expiryDate: null });
      const b = await repackStock(db, { ...base(), childQty: 1, packedOn: "2026-10-01", expiryDate: null });
      const c = await repackStock(db, { ...base(), childQty: 1, packedOn: "2026-09-30", expiryDate: null });
      expect([a.batchNo, b.batchNo, c.batchNo]).toEqual(["RP-20261001-1", "RP-20261001-2", "RP-20260930-1"]);
    });

    it("uses the earlier of the entered best-before and the bulk batch's expiry", async () => {
      await receive([{ qty: 10, expiryDate: "2026-12-01" }]);
      await receive([{ qty: 10 }]); // undated bulk batch

      // 15 packs: 10 from the dated batch, 5 from the undated one.
      await repackStock(db, { ...base(), childQty: 15, packedOn: TODAY, expiryDate: "2027-03-01" });
      const batches = (await listForProduct(db, storeId, childId)).sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""));
      expect(batches.map((b) => ({ qty: b.qtyRemaining, expiryDate: b.expiryDate }))).toEqual([
        { qty: 10, expiryDate: "2026-12-01" }, // bulk expires sooner
        { qty: 5, expiryDate: "2027-03-01" }, // bulk has no date: the entered one
      ]);
    });

    it("leaves the expiry empty when neither side has one", async () => {
      await receive([{ qty: 5 }]);
      const result = await repackStock(db, { ...base(), childQty: 5, packedOn: TODAY, expiryDate: null });
      const [batch] = await listForProduct(db, storeId, childId);
      expect(batch?.expiryDate).toBeNull();
      const repack = await db.selectFrom("repacks").select("expiryDate").where("id", "=", result.repackId).executeTakeFirstOrThrow();
      expect(repack.expiryDate).toBeNull();
    });

    it("refuses a future packed-on date and a best-before earlier than packed-on", async () => {
      await receive([{ qty: 10, expiryDate: "2027-01-01" }]);
      await expect(repackStock(db, { ...base(), childQty: 1, packedOn: "2026-10-02", expiryDate: null })).rejects.toThrow(
        /future/,
      );
      await expect(
        repackStock(db, { ...base(), childQty: 1, packedOn: "2026-10-01", expiryDate: "2026-09-30" }),
      ).rejects.toThrow(/earlier/);
      expect(await getStock(db, storeId, parentId)).toBe(10);
      expect(await db.selectFrom("repacks").selectAll().execute()).toHaveLength(0);
    });
  });

  describe("stock across pack sizes", () => {
    it("rolls packed stock into the parent's total, keeping the child's own count separate", async () => {
      await setReorderLevel(db, storeId, parentId, 5);
      await receive([{ qty: 50, expiryDate: "2027-01-01" }]);
      await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 20,
        userId,
        deviceId: "device-1",
        today: TODAY, packedOn: TODAY, expiryDate: null,
      });

      expect(await getPackStockByParent(db, storeId)).toEqual(new Map([[parentId, 20]]));

      const rows = await listProductsForAdmin(db, storeId, { query: "", includeInactive: false, limit: 50 });
      const parentRow = rows.find((r) => r.id === parentId);
      const childRow = rows.find((r) => r.id === childId);
      expect(parentRow).toMatchObject({ qtyOnHand: 30, packStockQty: 20 });
      expect(childRow).toMatchObject({ parentName: "Sugar 50kg Bag", packStockQty: null });

      // Repack the rest — the parent's own shelf is now empty, but it owns 50 packs' worth.
      await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 30,
        userId,
        deviceId: "device-1",
        today: TODAY, packedOn: TODAY, expiryDate: null,
      });
      expect(await getStock(db, storeId, parentId)).toBe(0);

      let lowStock = await getLowStock(db, storeId);
      expect(lowStock.find((r) => r.productId === parentId)).toBeUndefined();
      // The child itself has no reorder level set, so its own 50-pack count raises nothing either.
      expect(lowStock.find((r) => r.productId === childId)).toBeUndefined();

      // Deactivating the child hides it from billing, not from the rollup — goods are still there.
      await setProductActive(db, childId, false, { storeId, userId, deviceId: "device-1" });
      lowStock = await getLowStock(db, storeId);
      expect(lowStock.find((r) => r.productId === parentId)).toBeUndefined();

      // Only once the child's own stock is actually written off does the parent look out of stock.
      await recordStockAdjustment(db, {
        id: randomUUID(),
        ledgerId: randomUUID(),
        storeId,
        productId: childId,
        qtyAfter: 0,
        reason: "adjustment_correction",
        note: "test",
        userId,
        approvedByUserId: userId,
      });
      lowStock = await getLowStock(db, storeId);
      expect(lowStock.find((r) => r.productId === parentId)).toMatchObject({
        kind: "out_of_stock",
        packStockQty: 0,
      });
    });
  });
});
