import { randomUUID } from "node:crypto";

import type { Db } from "../connection.js";

import { createProduct } from "./productsAdmin.js";
import { recordStockAdjustment } from "./inventory.js";
import { kiranaCatalog, kiranaCategories, type KiranaUom } from "./kiranaCatalogData.js";

export interface SeedKiranaCatalogResult {
  categoriesCreated: number;
  productsCreated: number;
}

/**
 * Populates a store with the reference Tamil-bilingual kirana catalog (categories, products,
 * prices, and real opening stock recorded as a "manual_stock_in" adjustment per product).
 * Intended for a fresh/demo store — refuses to run if the store already has products, since
 * re-running would create duplicates.
 */
export async function seedKiranaCatalog(db: Db, storeId: string, userId: string): Promise<SeedKiranaCatalogResult> {
  const existingProduct = await db
    .selectFrom("products")
    .select("id")
    .where("storeId", "=", storeId)
    .executeTakeFirst();
  if (existingProduct) {
    throw new Error("Store already has products — seedKiranaCatalog must only run against an empty catalog.");
  }

  const categoryIds = new Map<string, string>();
  for (const name of kiranaCategories) {
    const id = randomUUID();
    await db.insertInto("categories").values({ id, storeId, name, parentId: null }).execute();
    categoryIds.set(name, id);
  }

  for (const item of kiranaCatalog) {
    const { uom, isWeighted, packSuffix } = deriveUnit(item.unit);
    const displayName = packSuffix ? `${item.name} (${packSuffix})` : item.name;
    const priceInPaise = Math.round(item.priceRupees * 100);

    const productId = await createProduct(db, {
      storeId,
      name: displayName,
      nameTamil: item.nameTamil,
      shortCode: item.sku,
      categoryId: categoryIds.get(item.category) ?? null,
      brandId: null,
      uom,
      isWeighted,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [item.tanglish],
      mrpPaise: priceInPaise,
      salePricePaise: priceInPaise,
      costPricePaise: 0,
      isTaxInclusive: true,
    });

    await recordStockAdjustment(db, {
      id: randomUUID(),
      ledgerId: randomUUID(),
      storeId,
      productId,
      qtyAfter: item.stockQty,
      reason: "manual_stock_in",
      note: "Opening stock from kirana catalog seed",
      userId,
      approvedByUserId: userId,
    });

    if (item.reorderLevel > 0) {
      await db
        .updateTable("inventory")
        .set({ reorderLevel: item.reorderLevel })
        .where("storeId", "=", storeId)
        .where("productId", "=", productId)
        .execute();
    }
  }

  return {
    categoriesCreated: categoryIds.size,
    productsCreated: kiranaCatalog.length,
  };
}

/**
 * "1 kg"/"1 L" items are priced and sold by weight/volume (loose staples); everything else
 * is a fixed pack sold as a discrete unit, with its pack size folded into the display name
 * since the catalog's price is per-pack, not per-kg/per-L.
 */
function deriveUnit(unit: string): { uom: KiranaUom; isWeighted: boolean; packSuffix: string | null } {
  if (unit === "1 kg") return { uom: "kg", isWeighted: true, packSuffix: null };
  if (unit === "1 L") return { uom: "l", isWeighted: true, packSuffix: null };
  return { uom: "pcs", isWeighted: false, packSuffix: unit };
}
