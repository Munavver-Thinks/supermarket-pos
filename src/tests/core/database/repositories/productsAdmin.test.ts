import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { listAuditLog } from "@/core/database/repositories/auditLog.js";
import { getLowStock, recordStockAdjustment } from "@/core/database/repositories/inventory.js";
import {
  findByBarcode,
  findByShortCode,
  getAllActiveForCache,
  getCostPrices,
  getUnsellableProductIds,
  listForBrowse,
  searchCandidates,
} from "@/core/database/repositories/products.js";
import {
  changeProductPrices,
  createProduct,
  DuplicateBarcodeError,
  DuplicateShortCodeError,
  getProductForEdit,
  listProductsForAdmin,
  ProductNotFoundError,
  setProductActive,
  updateProduct,
  type ProductAuditActor,
} from "@/core/database/repositories/productsAdmin.js";
import { createChildProduct } from "@/core/database/repositories/productPacks.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

describe("product management", () => {
  let db: Db;
  let actor: ProductAuditActor;
  let dal: string;

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
    actor = { storeId: seed.storeId, userId: seed.ownerUserId, deviceId: "device-1" };
    dal = await add("Toor Dal 1kg", { shortCode: "TD1", barcodes: ["8901000000011"], aliases: ["thuvaram"] });
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function add(
    name: string,
    extra: { shortCode?: string; barcodes?: string[]; aliases?: string[]; reorderLevel?: number } = {},
  ): Promise<string> {
    return createProduct(db, {
      storeId: actor.storeId,
      name,
      nameTamil: null,
      shortCode: extra.shortCode ?? null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: "0713",
      taxRatePercent: 0,
      barcodes: extra.barcodes ?? [],
      aliases: extra.aliases ?? [],
      mrpPaise: 16000,
      salePricePaise: 15000,
      costPricePaise: 12000,
      isTaxInclusive: true,
      reorderLevel: extra.reorderLevel,
    });
  }

  function details(overrides: Partial<Parameters<typeof updateProduct>[2]> = {}) {
    return {
      name: "Toor Dal 1kg",
      nameTamil: null,
      shortCode: "TD1",
      supplierId: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: "0713",
      taxRatePercent: 0,
      barcodes: ["8901000000011"],
      aliases: ["thuvaram"],
      reorderLevel: 0,
      rackLocation: null,
      shelfLifeDays: null,
      ...overrides,
    };
  }

  it("round-trips rack location and shelf life, and logs them when they change", async () => {
    expect(await getProductForEdit(db, dal)).toMatchObject({ rackLocation: null, shelfLifeDays: null });

    const updated = await updateProduct(db, dal, details({ rackLocation: "B-3", shelfLifeDays: 90 }), actor);
    expect(updated).toMatchObject({ rackLocation: "B-3", shelfLifeDays: 90 });
    const rows = await listProductsForAdmin(db, actor.storeId, { query: "", includeInactive: false, limit: 50 });
    expect(rows.find((r) => r.id === dal)).toMatchObject({ rackLocation: "B-3", shelfLifeDays: 90 });

    const [entry] = await listAuditLog(db, actor.storeId, { limit: 5, action: "product_updated" });
    expect(entry?.newValue).toMatchObject({ rackLocation: "B-3", shelfLifeDays: 90 });

    const created = await createProduct(db, {
      storeId: actor.storeId,
      name: "Murukku 200g",
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 5000,
      salePricePaise: 4500,
      costPricePaise: 3000,
      isTaxInclusive: true,
      rackLocation: "C-1",
      shelfLifeDays: 45,
    });
    expect(await getProductForEdit(db, created)).toMatchObject({ rackLocation: "C-1", shelfLifeDays: 45 });
  });

  it("lists pack sizes with what is on hand, biggest pack first, in one pass", async () => {
    expect((await getProductForEdit(db, dal))?.packs).toBeNull();

    const small = await createChildProduct(db, actor.storeId, {
      parentProductId: dal,
      name: "Dal 500g",
      nameTamil: null,
      packQty: 0.5,
      barcodes: [],
      aliases: [],
    });
    const big = await createChildProduct(db, actor.storeId, {
      parentProductId: dal,
      name: "Dal 1kg Pack",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });
    await db.updateTable("inventory").set({ qtyOnHand: 4 }).where("productId", "=", small).execute();
    await db.updateTable("inventory").set({ qtyOnHand: 10 }).where("productId", "=", big).execute();

    const rows = await listProductsForAdmin(db, actor.storeId, { query: "", includeInactive: false, limit: 50 });
    const parent = rows.find((r) => r.id === dal);
    expect(parent?.packs).toEqual([
      { name: "Dal 1kg Pack", packQty: 1, qtyOnHand: 10 },
      { name: "Dal 500g", packQty: 0.5, qtyOnHand: 4 },
    ]);
    expect(parent?.packStockQty).toBe(12);
    expect(rows.find((r) => r.id === small)?.packs).toBeNull();
    expect((await getProductForEdit(db, dal))?.packs).toHaveLength(2);
  });

  it("edits details, replacing barcodes and names, and logs only what changed", async () => {
    const updated = await updateProduct(
      db,
      dal,
      details({ name: "Toor Dal", nameTamil: "துவரம் பருப்பு", barcodes: ["8901000000011", "8901000000028"] }),
      actor,
    );
    expect(updated).toMatchObject({ name: "Toor Dal", nameTamil: "துவரம் பருப்பு" });
    expect(updated.barcodes).toEqual(["8901000000011", "8901000000028"]);

    // Billing search sees the new name straight away.
    expect((await searchCandidates(db, actor.storeId, "toor dal")).map((r) => r.name)).toContain("Toor Dal");
    expect((await findByBarcode(db, actor.storeId, "8901000000028"))?.productId).toBe(dal);

    const [entry] = await listAuditLog(db, actor.storeId, { limit: 5, action: "product_updated" });
    expect(entry?.recordId).toBe(dal);
    expect(entry?.oldValue).toEqual({ name: "Toor Dal 1kg", nameTamil: null, barcodes: ["8901000000011"] });
    expect(entry?.newValue).toEqual({
      name: "Toor Dal",
      nameTamil: "துவரம் பருப்பு",
      barcodes: ["8901000000011", "8901000000028"],
    });
  });

  it("refuses a barcode held by any other product, naming it — even a deactivated one", async () => {
    const oil = await add("Groundnut Oil", { barcodes: ["8902"] });
    await expect(updateProduct(db, dal, details({ barcodes: ["8902"] }), actor)).rejects.toThrow(
      "Barcode 8902 already belongs to Groundnut Oil.",
    );

    await setProductActive(db, oil, false, actor);
    await expect(updateProduct(db, dal, details({ barcodes: ["8902"] }), actor)).rejects.toThrow(
      DuplicateBarcodeError,
    );
    await expect(updateProduct(db, dal, details({ barcodes: ["8902"] }), actor)).rejects.toThrow("(deactivated)");
    await expect(add("Another", { barcodes: ["8902"] })).rejects.toThrow(DuplicateBarcodeError);

    // Nothing was half-applied.
    expect((await getProductForEdit(db, dal))?.barcodes).toEqual(["8901000000011"]);
  });

  it("refuses a short code another active product uses, but not a deactivated one's", async () => {
    const sugar = await add("Sugar", { shortCode: "SG1" });
    await expect(updateProduct(db, dal, details({ shortCode: "SG1" }), actor)).rejects.toThrow(DuplicateShortCodeError);
    await setProductActive(db, sugar, false, actor);
    await expect(updateProduct(db, dal, details({ shortCode: "SG1" }), actor)).resolves.toMatchObject({
      shortCode: "SG1",
    });
  });

  it("sets the reorder level on the inventory row without moving stock", async () => {
    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId: actor.storeId,
      productId: dal,
      qtyAfter: 8,
      reason: "manual_stock_in",
      note: null,
      userId: actor.userId,
      approvedByUserId: actor.userId,
    });
    const ledgerBefore = await db.selectFrom("stockLedger").select("id").execute();
    expect(await getLowStock(db, actor.storeId)).toEqual([]);

    await updateProduct(db, dal, details({ reorderLevel: 10 }), actor);

    expect(await db.selectFrom("stockLedger").select("id").execute()).toHaveLength(ledgerBefore.length);
    expect(await getLowStock(db, actor.storeId)).toEqual([
      {
        productId: dal,
        name: "Toor Dal 1kg",
        uom: "pcs",
        qtyOnHand: 8,
        reorderLevel: 10,
        packStockQty: null,
        kind: "low_stock",
      },
    ]);
  });

  it("changes prices as a new effective-dated row, keeping the old one", async () => {
    const changed = await changeProductPrices(
      db,
      dal,
      { mrpPaise: 16000, salePricePaise: 15500, costPricePaise: 12500, isTaxInclusive: true },
      actor,
    );
    expect(changed).toBe(true);

    const rows = await db.selectFrom("productPrices").selectAll().where("productId", "=", dal).execute();
    expect(rows).toHaveLength(2);
    const closed = rows.find((r) => r.effectiveTo !== null);
    const open = rows.find((r) => r.effectiveTo === null);
    expect(closed?.salePricePaise).toBe(15000);
    expect(open?.salePricePaise).toBe(15500);
    expect(await getCostPrices(db, [dal])).toEqual({ [dal]: 12500 });
    expect((await findByBarcode(db, actor.storeId, "8901000000011"))?.salePricePaise).toBe(15500);

    const [entry] = await listAuditLog(db, actor.storeId, { limit: 5, action: "product_price_changed" });
    expect(entry?.oldValue).toMatchObject({ salePricePaise: 15000, costPricePaise: 12000 });
    expect(entry?.newValue).toMatchObject({ name: "Toor Dal 1kg", salePricePaise: 15500, costPricePaise: 12500 });

    // Same prices again: nothing written.
    expect(
      await changeProductPrices(
        db,
        dal,
        { mrpPaise: 16000, salePricePaise: 15500, costPricePaise: 12500, isTaxInclusive: true },
        actor,
      ),
    ).toBe(false);
    expect(await db.selectFrom("productPrices").selectAll().where("productId", "=", dal).execute()).toHaveLength(2);
    expect(await listAuditLog(db, actor.storeId, { limit: 5, action: "product_price_changed" })).toHaveLength(1);
  });

  it("hides a deactivated product from every billing lookup and brings it back", async () => {
    await setProductActive(db, dal, false, actor);

    expect(await findByBarcode(db, actor.storeId, "8901000000011")).toBeUndefined();
    expect(await findByShortCode(db, actor.storeId, "TD1")).toBeUndefined();
    expect(await searchCandidates(db, actor.storeId, "thuvaram")).toEqual([]);
    expect(await searchCandidates(db, actor.storeId, "toor")).toEqual([]);
    expect(await getAllActiveForCache(db, actor.storeId)).toEqual([]);
    expect(await listForBrowse(db, actor.storeId)).toEqual([]);
    expect(await getUnsellableProductIds(db, actor.storeId, [dal])).toEqual([dal]);

    // Still listed for the owner when inactive products are asked for.
    expect(await listProductsForAdmin(db, actor.storeId, { query: "", includeInactive: false, limit: 50 })).toEqual([]);
    const all = await listProductsForAdmin(db, actor.storeId, { query: "", includeInactive: true, limit: 50 });
    expect(all.map((p) => [p.name, p.isActive])).toEqual([["Toor Dal 1kg", false]]);

    await setProductActive(db, dal, true, actor);
    expect((await findByBarcode(db, actor.storeId, "8901000000011"))?.productId).toBe(dal);
    expect(await findByShortCode(db, actor.storeId, "TD1")).toBeDefined();
    expect(await getAllActiveForCache(db, actor.storeId)).toHaveLength(1);
    expect(await listForBrowse(db, actor.storeId)).toHaveLength(1);
    expect(await getUnsellableProductIds(db, actor.storeId, [dal])).toEqual([]);

    expect(await listAuditLog(db, actor.storeId, { limit: 5, action: "product_deactivated" })).toHaveLength(1);
    expect(await listAuditLog(db, actor.storeId, { limit: 5, action: "product_reactivated" })).toHaveLength(1);
    // Setting the same state again writes nothing.
    expect(await setProductActive(db, dal, true, actor)).toBe(false);
  });

  it("treats a product from another store as unsellable and not found", async () => {
    const stranger = { ...actor, storeId: randomUUID() };
    expect(await getUnsellableProductIds(db, stranger.storeId, [dal])).toEqual([dal]);
    await expect(setProductActive(db, dal, false, stranger)).rejects.toThrow(ProductNotFoundError);
    await expect(updateProduct(db, dal, details(), stranger)).rejects.toThrow(ProductNotFoundError);
    await expect(
      changeProductPrices(db, dal, { mrpPaise: 1, salePricePaise: 1, costPricePaise: 1, isTaxInclusive: true }, stranger),
    ).rejects.toThrow(ProductNotFoundError);
  });

  it("finds products by name, short code or barcode for the admin list", async () => {
    await add("Sugar 1kg", { shortCode: "SG1", barcodes: ["777"] });
    const find = (query: string) =>
      listProductsForAdmin(db, actor.storeId, { query, includeInactive: false, limit: 50 }).then((rows) =>
        rows.map((r) => r.name),
      );
    expect(await find("sug")).toEqual(["Sugar 1kg"]);
    expect(await find("TD1")).toEqual(["Toor Dal 1kg"]);
    expect(await find("777")).toEqual(["Sugar 1kg"]);
    expect(await find("")).toEqual(["Sugar 1kg", "Toor Dal 1kg"]);

    const [row] = await listProductsForAdmin(db, actor.storeId, { query: "TD1", includeInactive: false, limit: 5 });
    expect(row).toMatchObject({ salePricePaise: 15000, costPricePaise: 12000, qtyOnHand: 0, barcodes: ["8901000000011"] });
  });

  it("stores a reorder level given when the product is created", async () => {
    const rice = await add("Rice", { reorderLevel: 5 });
    expect((await getProductForEdit(db, rice))?.reorderLevel).toBe(5);
    // Nothing on hand at all → out of stock, whatever the level.
    expect((await getLowStock(db, actor.storeId)).map((r) => [r.name, r.kind])).toEqual([
      ["Rice", "out_of_stock"],
      ["Toor Dal 1kg", "out_of_stock"],
    ]);
  });
});
