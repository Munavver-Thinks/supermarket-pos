import { randomUUID } from "node:crypto";

import { computePurchaseTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { ensureProductBarcode, getLabelDefaults, LabelError, listRepackHistory, recordLabelPrint } from "./labels.js";
import { createChildProduct } from "./productPacks.js";
import { createProduct, updateProduct } from "./productsAdmin.js";
import { createPurchase } from "./purchases.js";
import { repackStock } from "./repack.js";
import { seedFirstRun } from "./seed.js";
import { getSetting } from "./settings.js";
import { createSupplier } from "./suppliers.js";

const TODAY = "2026-10-07";

describe("labels", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let supplierId: string;
  let parentId: string;
  let childId: string;
  const audit = () => ({ userId, deviceId: "device-1" });

  const newProduct = (name: string, barcodes: string[] = []) =>
    createProduct(db, {
      storeId,
      name,
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes,
      aliases: [],
      mrpPaise: 3000,
      salePricePaise: 2400,
      costPricePaise: 2000,
      isTaxInclusive: true,
    });

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Test Org",
      storeName: "Apple Super Market",
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
      rackLocation: "B-3",
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

  async function receive(qty: number, expiryDate: string) {
    const { lines, totals } = computePurchaseTotals([
      { productId: parentId, qty, costPricePaise: 5000, taxRatePercent: 0, isTaxInclusive: false, expiryDate },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: `INV-${randomUUID().slice(0, 8)}`,
      invoiceDate: TODAY,
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });
  }

  describe("ensureProductBarcode", () => {
    it("assigns sequential in-store barcodes and saves them to the product", async () => {
      const a = await newProduct("Dal 100g");
      const b = await newProduct("Rice 100g");
      expect(await ensureProductBarcode(db, storeId, a, audit())).toEqual({ barcode: "20000001", assigned: true });
      expect(await ensureProductBarcode(db, storeId, b, audit())).toEqual({ barcode: "20000002", assigned: true });
      expect(await getSetting(db, "label_barcode_seq")).toBe("2");

      const saved = await db.selectFrom("productBarcodes").select("barcode").where("productId", "=", a).execute();
      expect(saved).toEqual([{ barcode: "20000001" }]);

      const [entry] = await listAuditLog(db, storeId, { limit: 5, action: "barcode_assigned" });
      expect(entry?.newValue).toMatchObject({ barcode: "20000002" });
    });

    it("reuses the barcode a product already has", async () => {
      const a = await newProduct("Dal 100g");
      await ensureProductBarcode(db, storeId, a, audit());
      expect(await ensureProductBarcode(db, storeId, a, audit())).toEqual({ barcode: "20000001", assigned: false });

      const own = await newProduct("Salt 1kg", ["8901234", "1234567"]);
      expect(await ensureProductBarcode(db, storeId, own, audit())).toEqual({ barcode: "1234567", assigned: false });
      expect(await getSetting(db, "label_barcode_seq")).toBe("1");
    });

    it("skips a code that is already taken", async () => {
      await newProduct("Taken", ["20000001"]);
      const a = await newProduct("Dal 100g");
      expect(await ensureProductBarcode(db, storeId, a, audit())).toEqual({ barcode: "20000002", assigned: true });
    });

    it("refuses a product from another store", async () => {
      const a = await newProduct("Dal 100g");
      await expect(ensureProductBarcode(db, randomUUID(), a, audit())).rejects.toThrow(LabelError);
    });
  });

  describe("getLabelDefaults", () => {
    it("takes dates, MRP and copies from the repack when one is given", async () => {
      await receive(20, "2026-12-01");
      const repack = await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 12,
        userId,
        deviceId: null,
        today: TODAY,
        packedOn: "2026-10-05",
        expiryDate: "2027-03-01",
      });

      const defaults = await getLabelDefaults(db, storeId, childId, repack.repackId);
      expect(defaults).toMatchObject({
        productName: "Sugar 1kg",
        storeName: "Apple Super Market",
        barcode: null,
        mrpPaise: 6500,
        salePricePaise: 6000,
        packedOn: "2026-10-05",
        expiryDate: "2026-12-01",
        suggestedCopies: 12,
        qtyOnHand: 12,
        uom: "pcs",
      });
    });

    it("falls back to the latest batch with stock, with copies from the stock on hand", async () => {
      await receive(20, "2026-12-01");
      await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 4,
        userId,
        deviceId: null,
        today: TODAY,
        packedOn: "2026-10-06",
        expiryDate: null,
      });

      const defaults = await getLabelDefaults(db, storeId, childId, null);
      expect(defaults).toMatchObject({ packedOn: "2026-10-06", expiryDate: "2026-12-01", suggestedCopies: 4 });
    });

    it("uses the product's own MRP and no dates when there is no batch, and shows the rack", async () => {
      const defaults = await getLabelDefaults(db, storeId, parentId, null);
      expect(defaults).toMatchObject({
        packedOn: null,
        expiryDate: null,
        mrpPaise: 6500,
        suggestedCopies: 0,
        rackLocation: "B-3",
      });
    });

    it("caps the suggested copies at 500 and refuses a repack of another product", async () => {
      const big = await newProduct("Bulk pens");
      await db.updateTable("inventory").set({ qtyOnHand: 900 }).where("productId", "=", big).execute();
      expect((await getLabelDefaults(db, storeId, big, null)).suggestedCopies).toBe(500);
      await expect(getLabelDefaults(db, storeId, big, randomUUID())).rejects.toThrow(LabelError);
    });
  });

  describe("recordLabelPrint and history", () => {
    it("records a print with its audit entry and aggregates it in the repack history", async () => {
      await receive(10, "2026-12-01");
      await receive(10, "2027-02-01");
      const repack = await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 15,
        userId,
        deviceId: null,
        today: TODAY,
        packedOn: TODAY,
        expiryDate: null,
      });
      const untouched = await repackStock(db, {
        storeId,
        parentProductId: parentId,
        childProductId: childId,
        childQty: 2,
        userId,
        deviceId: null,
        today: TODAY,
        packedOn: TODAY,
        expiryDate: null,
      });

      for (const count of [10, 5]) {
        await recordLabelPrint(
          db,
          {
            storeId,
            productId: childId,
            repackId: repack.repackId,
            labelCount: count,
            barcode: "20000001",
            packedOn: TODAY,
            expiryDate: "2026-12-01",
            mrpPaise: 6500,
            salePricePaise: 6000,
            userId,
          },
          audit(),
        );
      }

      const entries = await listAuditLog(db, storeId, { limit: 5, action: "labels_printed" });
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.newValue).toMatchObject({ productName: "Sugar 1kg", barcode: "20000001", batchNo: repack.batchNo });
      }

      // Asked from the parent's side and from the child's side: same two repacks, newest first.
      for (const productId of [parentId, childId]) {
        const history = await listRepackHistory(db, storeId, productId);
        expect(history.map((h) => h.repackId)).toEqual([untouched.repackId, repack.repackId]);
      }

      const history = await listRepackHistory(db, storeId, parentId);
      expect(history[1]).toMatchObject({
        batchNo: repack.batchNo,
        packedOn: TODAY,
        parentName: "Sugar 50kg Bag",
        childName: "Sugar 1kg",
        childProductId: childId,
        childQty: 15,
        parentQtyUsed: 15,
        parentUom: "kg",
        userName: "Owner",
        labelsPrinted: 15,
      });
      expect(history[1]?.sources.map((s) => ({ qty: s.qty, expiryDate: s.expiryDate }))).toEqual([
        { qty: 10, expiryDate: "2026-12-01" },
        { qty: 5, expiryDate: "2027-02-01" },
      ]);
      expect(history[0]?.labelsPrinted).toBe(0);
    });

    it("limits the history", async () => {
      await receive(10, "2026-12-01");
      for (let i = 0; i < 3; i++) {
        await repackStock(db, {
          storeId,
          parentProductId: parentId,
          childProductId: childId,
          childQty: 1,
          userId,
          deviceId: null,
          today: TODAY,
          packedOn: TODAY,
          expiryDate: null,
        });
      }
      expect(await listRepackHistory(db, storeId, childId, 2)).toHaveLength(2);
    });
  });

  it("round-trips through product edits without losing the barcode it assigned", async () => {
    const a = await newProduct("Dal 100g");
    await ensureProductBarcode(db, storeId, a, audit());
    const [barcode] = (await db.selectFrom("productBarcodes").select("barcode").where("productId", "=", a).execute()).map(
      (r) => r.barcode,
    );
    const after = await updateProduct(
      db,
      a,
      {
        name: "Dal 100g",
        nameTamil: null,
        shortCode: null,
        supplierId: null,
        uom: "pcs",
        isWeighted: false,
        hsnCode: null,
        taxRatePercent: 0,
        barcodes: barcode ? [barcode] : [],
        aliases: [],
        reorderLevel: 0,
        rackLocation: "A-1",
        shelfLifeDays: 30,
      },
      { storeId, userId, deviceId: null },
    );
    expect(after).toMatchObject({ barcodes: ["20000001"], rackLocation: "A-1", shelfLifeDays: 30 });
  });
});
