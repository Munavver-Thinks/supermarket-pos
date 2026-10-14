import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { createChildProduct, listChildren, ParentIsAChildError } from "@/core/database/repositories/productPacks.js";
import { changeProductPrices, createProduct, getProductForEdit, ProductNotFoundError, relinkChildPrice } from "@/core/database/repositories/productsAdmin.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";

describe("product packs", () => {
  let db: Db;
  let storeId: string;
  let userId: string;
  let parentId: string;

  const actor = () => ({ storeId, userId, deviceId: "device-1" });

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
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates a child linked to the parent's price by default", async () => {
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });

    const child = await getProductForEdit(db, childId);
    expect(child).toMatchObject({
      parentProductId: parentId,
      packQty: 1,
      priceLinkedToParent: true,
      salePricePaise: 6000,
      mrpPaise: 6500,
      costPricePaise: 5000,
      uom: "pcs",
      isWeighted: false,
    });
  });

  it("derives a fractional pack's price, rounded to the nearest paisa", async () => {
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 500g",
      nameTamil: null,
      packQty: 0.5,
      barcodes: [],
      aliases: [],
    });
    const child = await getProductForEdit(db, childId);
    expect(child).toMatchObject({ salePricePaise: 3000, mrpPaise: 3250, costPricePaise: 2500 });
  });

  it("starts unlinked when the owner types a deliberate starting price", async () => {
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg (festival price)",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
      prices: { mrpPaise: 7000, salePricePaise: 6500, costPricePaise: 5000, isTaxInclusive: true },
    });
    const child = await getProductForEdit(db, childId);
    expect(child).toMatchObject({ priceLinkedToParent: false, salePricePaise: 6500 });
  });

  it("refuses to make a pack from another pack — one level only", async () => {
    const childId = await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });
    await expect(
      createChildProduct(db, storeId, {
        parentProductId: childId,
        name: "Sugar 500g from 1kg",
        nameTamil: null,
        packQty: 0.5,
        barcodes: [],
        aliases: [],
      }),
    ).rejects.toThrow(ParentIsAChildError);
  });

  it("refuses a parent that doesn't exist or belongs to another store", async () => {
    await expect(
      createChildProduct(db, storeId, {
        parentProductId: "not-a-real-id",
        name: "Sugar 1kg",
        nameTamil: null,
        packQty: 1,
        barcodes: [],
        aliases: [],
      }),
    ).rejects.toThrow(ProductNotFoundError);
  });

  it("lists every pack size of a product, largest first", async () => {
    await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 500g",
      nameTamil: null,
      packQty: 0.5,
      barcodes: [],
      aliases: [],
    });
    await createChildProduct(db, storeId, {
      parentProductId: parentId,
      name: "Sugar 1kg",
      nameTamil: null,
      packQty: 1,
      barcodes: [],
      aliases: [],
    });

    const children = await listChildren(db, storeId, parentId);
    expect(children.map((c) => c.name)).toEqual(["Sugar 1kg", "Sugar 500g"]);
    expect(children[0]).toMatchObject({ packQty: 1, priceLinkedToParent: true, salePricePaise: 6000, qtyOnHand: 0 });
  });

  describe("price cascade", () => {
    let childId: string;

    beforeEach(async () => {
      childId = await createChildProduct(db, storeId, {
        parentProductId: parentId,
        name: "Sugar 1kg",
        nameTamil: null,
        packQty: 1,
        barcodes: [],
        aliases: [],
      });
    });

    it("recalculates a linked child when the parent's price changes", async () => {
      await changeProductPrices(
        db,
        parentId,
        { mrpPaise: 7000, salePricePaise: 6500, costPricePaise: 5500, isTaxInclusive: true },
        actor(),
      );
      const child = await getProductForEdit(db, childId);
      expect(child).toMatchObject({ salePricePaise: 6500, mrpPaise: 7000, costPricePaise: 5500, priceLinkedToParent: true });
    });

    it("unlinks a child the moment its own price is edited directly, and never touches it again", async () => {
      await changeProductPrices(
        db,
        childId,
        { mrpPaise: 7500, salePricePaise: 7000, costPricePaise: 5000, isTaxInclusive: true },
        actor(),
      );
      let child = await getProductForEdit(db, childId);
      expect(child).toMatchObject({ priceLinkedToParent: false, salePricePaise: 7000 });

      // The parent's price moves again — the unlinked child must not follow it this time.
      await changeProductPrices(
        db,
        parentId,
        { mrpPaise: 8000, salePricePaise: 7500, costPricePaise: 6000, isTaxInclusive: true },
        actor(),
      );
      child = await getProductForEdit(db, childId);
      expect(child?.salePricePaise).toBe(7000);
    });

    it("leaves an unrelated product's own price change alone — no cascade for a non-parent", async () => {
      const other = await createProduct(db, {
        storeId,
        name: "Rice 1kg",
        nameTamil: null,
        shortCode: null,
        uom: "pcs",
        isWeighted: false,
        hsnCode: null,
        taxRatePercent: 0,
        barcodes: [],
        aliases: [],
        mrpPaise: 10000,
        salePricePaise: 9500,
        costPricePaise: 8000,
        isTaxInclusive: true,
      });
      await changeProductPrices(db, other, { mrpPaise: 11000, salePricePaise: 10000, costPricePaise: 8500, isTaxInclusive: true }, actor());
      const child = await getProductForEdit(db, childId);
      expect(child?.salePricePaise).toBe(6000); // unchanged — Rice isn't Sugar's parent
    });

    it("relinks a child back to the parent's current price on demand", async () => {
      await changeProductPrices(
        db,
        childId,
        { mrpPaise: 7500, salePricePaise: 7000, costPricePaise: 5000, isTaxInclusive: true },
        actor(),
      );
      await changeProductPrices(
        db,
        parentId,
        { mrpPaise: 8000, salePricePaise: 7500, costPricePaise: 6000, isTaxInclusive: true },
        actor(),
      );

      const relinked = await relinkChildPrice(db, childId, actor());
      expect(relinked).toMatchObject({ priceLinkedToParent: true, salePricePaise: 7500, mrpPaise: 8000, costPricePaise: 6000 });

      // And it follows again from here on.
      await changeProductPrices(db, parentId, { mrpPaise: 8500, salePricePaise: 8000, costPricePaise: 6500, isTaxInclusive: true }, actor());
      const child = await getProductForEdit(db, childId);
      expect(child?.salePricePaise).toBe(8000);
    });
  });
});
