import { randomUUID } from "node:crypto";

import { computePurchaseTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../connection.js";
import { runMigrations } from "../migrator.js";

import { listAuditLog } from "./auditLog.js";
import { applyStockMovement, getStock } from "./inventory.js";
import { createChildProduct } from "./productPacks.js";
import { createProduct } from "./productsAdmin.js";
import {
  createPurchase,
  DuplicatePurchaseInvoiceError,
  getPriceSnapshots,
  getPurchaseWithItems,
  listRecentPurchases,
} from "./purchases.js";
import { seedFirstRun } from "./seed.js";
import { listForProduct } from "./stockBatches.js";
import { createSupplier, listSuppliers, setSupplierActive, updateSupplier } from "./suppliers.js";

describe("suppliers + purchases", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let supplierId: string;
  let productId: string;

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

    const supplier = await createSupplier(db, storeId, {
      name: "Sri Balaji Traders",
      phone: "9876543210",
      email: null,
      address: "Market Road",
      gstin: "33AAAAA0000A1Z5",
      notes: null,
    });
    supplierId = supplier.id;

    productId = await createProduct(db, {
      storeId,
      name: "Toor Dal",
      nameTamil: null,
      shortCode: "PD-001",
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 16500,
      salePricePaise: 16500,
      costPricePaise: 14000,
      isTaxInclusive: true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates, updates, lists and deactivates a supplier", async () => {
    const suppliers = await listSuppliers(db, storeId);
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]?.name).toBe("Sri Balaji Traders");
    expect(suppliers[0]?.isActive).toBe(true);

    const updated = await updateSupplier(db, supplierId, {
      name: "Sri Balaji Traders & Co",
      phone: "9000000000",
      email: "balaji@example.com",
      address: "Market Road",
      gstin: "33AAAAA0000A1Z5",
      notes: "Delivers on Tuesdays",
    });
    expect(updated.name).toBe("Sri Balaji Traders & Co");
    expect(updated.email).toBe("balaji@example.com");

    await setSupplierActive(db, supplierId, false);
    expect(await listSuppliers(db, storeId)).toHaveLength(0);
    expect(await listSuppliers(db, storeId, true)).toHaveLength(1);
  });

  it("records a purchase, raises stock, and appends one ledger entry per line", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 25, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
    ]);

    const purchase = await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-001",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    expect(purchase.totalPaise).toBe(350000);
    expect(await getStock(db, storeId, productId)).toBe(25);

    const ledger = await db.selectFrom("stockLedger").selectAll().where("storeId", "=", storeId).execute();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.reason).toBe("purchase_received");
    expect(ledger[0]?.referenceType).toBe("purchase");
    expect(ledger[0]?.referenceId).toBe(purchase.id);
    expect(ledger[0]?.qtyChange).toBe(25);
  });

  it("refuses to record the same supplier invoice twice, leaving stock untouched", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    const args = {
      storeId,
      supplierId,
      invoiceNo: "INV-DUP",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    };

    await createPurchase(db, args);
    await expect(createPurchase(db, args)).rejects.toThrow(DuplicatePurchaseInvoiceError);

    expect(await getStock(db, storeId, productId)).toBe(10);
    expect(await db.selectFrom("purchases").selectAll().execute()).toHaveLength(1);
  });

  it("opens a new effective-dated cost price when asked, keeping the old row as history", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false },
    ]);

    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-002",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const prices = await db.selectFrom("productPrices").selectAll().where("productId", "=", productId).execute();
    expect(prices).toHaveLength(2);

    const open = prices.filter((p) => p.effectiveTo === null);
    expect(open).toHaveLength(1);
    expect(open[0]?.costPricePaise).toBe(15000);
    // MRP and sale price ride through untouched — only the cost changed.
    expect(open[0]?.salePricePaise).toBe(16500);
    expect(prices.find((p) => p.effectiveTo !== null)?.costPricePaise).toBe(14000);
  });

  it("rolls the whole purchase back if a line fails, leaving no stock or header behind", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 5, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
      // Second line points at a product that does not exist — the FK blows up mid-transaction.
      { productId: "00000000-0000-4000-8000-000000000000", qty: 5, costPricePaise: 1000, taxRatePercent: 0, isTaxInclusive: false },
    ]);

    await expect(
      createPurchase(db, {
        storeId,
        supplierId,
        invoiceNo: "INV-BAD",
        invoiceDate: "2026-09-13",
        notes: null,
        userId,
        lines,
        totals,
        updateCostPrice: false,
      }),
    ).rejects.toThrow();

    expect(await db.selectFrom("purchases").selectAll().execute()).toHaveLength(0);
    expect(await db.selectFrom("stockLedger").selectAll().execute()).toHaveLength(0);
    expect(await getStock(db, storeId, productId)).toBe(0);
  });

  it("lists recent purchases with supplier name and line count", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 4, costPricePaise: 14000, taxRatePercent: 5, isTaxInclusive: false },
    ]);

    const created = await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-003",
      invoiceDate: "2026-09-13",
      notes: "Weekly order",
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const listed = await listRecentPurchases(db, storeId, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.supplierName).toBe("Sri Balaji Traders");
    expect(listed[0]?.itemCount).toBe(1);
    expect(listed[0]?.totalPaise).toBe(58800);

    const detail = await getPurchaseWithItems(db, created.id);
    expect(detail?.supplierName).toBe("Sri Balaji Traders");
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0]?.productName).toBe("Toor Dal");
    expect(detail?.items[0]?.uom).toBe("kg");
  });

  it("blends a receipt's cost with the stock already on the shelf (weighted average)", async () => {
    // 10kg already on the shelf at ₹140; this receipt brings in 10kg more at ₹150 — the
    // weighted average of 10@140 + 10@150 is 145, not a flat overwrite to 150.
    const first = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-AVG-1",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines: first.lines,
      totals: first.totals,
      updateCostPrice: true,
    });

    const second = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-AVG-2",
      invoiceDate: "2026-09-14",
      notes: null,
      userId,
      lines: second.lines,
      totals: second.totals,
      updateCostPrice: true,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", productId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open?.costPricePaise).toBe(14500);
    expect(await getStock(db, storeId, productId)).toBe(20);
  });

  it("leaves the cost unchanged when a received line has no qty or no taxable value", async () => {
    const zeroQty = computePurchaseTotals([
      { productId, qty: 0, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-ZERO",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines: zeroQty.lines,
      totals: zeroQty.totals,
      updateCostPrice: true,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", productId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open?.costPricePaise).toBe(14000);
    expect(await db.selectFrom("auditLogs").selectAll().where("action", "=", "cost_price_changed").execute()).toHaveLength(0);
  });

  it("keeps the wholesale price when a receipt updates the cost (regression: it used to be nulled out)", async () => {
    const wholesaleProductId = await createProduct(db, {
      storeId,
      name: "Sugar",
      nameTamil: null,
      shortCode: null,
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4800,
      costPricePaise: 4000,
      wholesalePricePaise: 4300,
      isTaxInclusive: true,
    });

    const { lines, totals } = computePurchaseTotals([
      { productId: wholesaleProductId, qty: 10, costPricePaise: 4500, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-WS",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", wholesaleProductId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open?.costPricePaise).toBe(4500);
    expect(open?.wholesalePricePaise).toBe(4300);
  });

  it("cascades a receipt's averaged cost down to linked pack-size children", async () => {
    const parentId = await createProduct(db, {
      storeId,
      name: "Sugar 50kg Bag",
      nameTamil: null,
      shortCode: null,
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4800,
      costPricePaise: 4000,
      isTaxInclusive: true,
    });
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });

    const { lines, totals } = computePurchaseTotals([
      { productId: parentId, qty: 50, costPricePaise: 5000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-CASCADE",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const parentOpen = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", parentId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(parentOpen?.costPricePaise).toBe(5000);

    const childOpen = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", childId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    // packQty 1, so the child's cost follows the parent's new cost exactly.
    expect(childOpen?.costPricePaise).toBe(5000);
  });

  it("leaves a linked child's own cost updated but still linked when it receives stock directly", async () => {
    const parentId = await createProduct(db, {
      storeId,
      name: "Rice 50kg Bag",
      nameTamil: null,
      shortCode: null,
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 6000,
      salePricePaise: 5800,
      costPricePaise: 5000,
      isTaxInclusive: true,
    });
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Rice 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });

    const { lines, totals } = computePurchaseTotals([
      { productId: childId, qty: 20, costPricePaise: 6000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-CHILD-DIRECT",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const childOpen = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", childId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(childOpen?.costPricePaise).toBe(6000);

    const child = await db.selectFrom("products").select(["priceLinkedToParent"]).where("id", "=", childId).executeTakeFirst();
    expect(child?.priceLinkedToParent).toBe(1);
  });

  it("returns a current price + stock snapshot per product, and an empty map for no ids", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-SNAP",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const snapshots = await getPriceSnapshots(db, storeId, [productId]);
    expect(snapshots[productId]).toMatchObject({
      productId,
      costPricePaise: 14000,
      salePricePaise: 16500,
      wholesalePricePaise: null,
      isTaxInclusive: true,
      taxRatePercent: 0,
      qtyOnHand: 10,
    });

    expect(await getPriceSnapshots(db, storeId, [])).toEqual({});
  });

  it("flat-replaces the product's MRP from a receipt, writing cost and MRP together in one new row", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 18000 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-1",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const prices = await db.selectFrom("productPrices").selectAll().where("productId", "=", productId).execute();
    expect(prices).toHaveLength(2);
    const open = prices.find((p) => p.effectiveTo === null);
    // MRP flat-replaced (never blended like cost); sale rides through unchanged since the new
    // MRP is above it.
    expect(open).toMatchObject({ costPricePaise: 15000, mrpPaise: 18000, salePricePaise: 16500 });
  });

  it("changes only the MRP when updateCostPrice is off, writing no cost_price_changed entry", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 18000 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-2",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", productId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open?.costPricePaise).toBe(14000);
    expect(open?.mrpPaise).toBe(18000);
    expect(await db.selectFrom("auditLogs").selectAll().where("action", "=", "cost_price_changed").execute()).toHaveLength(0);
    expect(await db.selectFrom("auditLogs").selectAll().where("action", "=", "mrp_changed").execute()).toHaveLength(1);
  });

  it("pins pre-existing untracked stock to the old MRP before a receipt changes it", async () => {
    // 5 units already on the shelf with no batch of their own (e.g. counted in before
    // batch-level MRP tracking existed).
    await db.transaction().execute((trx) =>
      applyStockMovement(trx, {
        id: randomUUID(),
        storeId,
        productId,
        qtyChange: 5,
        reason: "manual_stock_in",
        referenceType: "manual",
        referenceId: randomUUID(),
        userId,
      }),
    );

    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 18000 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-3",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const batches = await listForProduct(db, storeId, productId);
    expect(batches).toHaveLength(2);
    // Pinned to 16500 — the product's MRP right before this receipt changed it to 18000.
    const pinned = batches.find((b) => b.purchaseId === null);
    expect(pinned).toMatchObject({ qtyReceived: 5, qtyRemaining: 5, mrpPaise: 16500 });
    const received = batches.find((b) => b.purchaseId !== null);
    expect(received).toMatchObject({ qtyReceived: 10, mrpPaise: 18000 });
  });

  it("writes an mrp_changed audit entry with the before/after mrp, sale and wholesale", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 15000 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-4",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const [entry] = await listAuditLog(db, storeId, { limit: 10, action: "mrp_changed" });
    expect(entry?.recordId).toBe(productId);
    expect(entry?.oldValue).toMatchObject({ mrpPaise: 16500, salePricePaise: 16500, wholesalePricePaise: null });
    expect(entry?.newValue).toMatchObject({
      mrpPaise: 15000,
      salePricePaise: 15000,
      wholesalePricePaise: null,
      qtyReceived: 10,
    });
  });

  it("lowers the sale and wholesale price in the same row when the new MRP undercuts them", async () => {
    const wsProductId = await createProduct(db, {
      storeId,
      name: "Chili Powder",
      nameTamil: null,
      shortCode: null,
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4800,
      costPricePaise: 4000,
      wholesalePricePaise: 4300,
      isTaxInclusive: true,
    });

    const { lines, totals } = computePurchaseTotals([
      { productId: wsProductId, qty: 10, costPricePaise: 4100, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 4200 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-5",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", wsProductId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open).toMatchObject({ mrpPaise: 4200, salePricePaise: 4200, wholesalePricePaise: 4200 });
  });

  it("leaves the MRP untouched when a receipt line doesn't send one", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId, qty: 10, costPricePaise: 15000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-6",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const open = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", productId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    expect(open?.mrpPaise).toBe(16500);
    expect(await db.selectFrom("auditLogs").selectAll().where("action", "=", "mrp_changed").execute()).toHaveLength(0);
  });

  it("cascades a receipt's new MRP down to linked pack-size children", async () => {
    const parentId = await createProduct(db, {
      storeId,
      name: "Sugar 50kg Bag",
      nameTamil: null,
      shortCode: null,
      supplierId,
      uom: "kg",
      isWeighted: true,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4800,
      costPricePaise: 4000,
      isTaxInclusive: true,
    });
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });

    const { lines, totals } = computePurchaseTotals([
      { productId: parentId, qty: 50, costPricePaise: 4200, taxRatePercent: 0, isTaxInclusive: false, mrpPaise: 5500 },
    ]);
    await createPurchase(db, {
      storeId,
      supplierId,
      invoiceNo: "INV-MRP-CASCADE",
      invoiceDate: "2026-09-13",
      notes: null,
      userId,
      lines,
      totals,
      updateCostPrice: true,
    });

    const childOpen = await db
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", childId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    // packQty 1, so the child's MRP follows the parent's new MRP exactly.
    expect(childOpen?.mrpPaise).toBe(5500);
  });
});
