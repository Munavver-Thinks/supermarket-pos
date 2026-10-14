import { randomUUID } from "node:crypto";

import type { Db } from "../connection.js";

import { createProduct } from "./productsAdmin.js";
import { groceryCatalog, groceryCategories } from "./groceryCatalogData.js";

export interface SeedGroceryCatalogResult {
  categoriesCreated: number;
  brandsCreated: number;
  productsCreated: number;
}

/**
 * Populates a store with the reference grocery catalog (categories, brands, products,
 * prices, zero-qty inventory rows). Intended for a fresh/demo store — refuses to run
 * if the store already has products, since re-running would create duplicates.
 */
export async function seedGroceryCatalog(db: Db, storeId: string): Promise<SeedGroceryCatalogResult> {
  const existingProduct = await db
    .selectFrom("products")
    .select("id")
    .where("storeId", "=", storeId)
    .executeTakeFirst();
  if (existingProduct) {
    throw new Error("Store already has products — seedGroceryCatalog must only run against an empty catalog.");
  }

  const categoryIds = new Map<string, string>();
  for (const name of groceryCategories) {
    const id = randomUUID();
    await db.insertInto("categories").values({ id, storeId, name, parentId: null }).execute();
    categoryIds.set(name, id);
  }

  const brandNames = [...new Set(groceryCatalog.map((p) => p.brand).filter((b): b is string => b !== null))];
  const brandIds = new Map<string, string>();
  for (const name of brandNames) {
    const id = randomUUID();
    await db.insertInto("brands").values({ id, storeId, name }).execute();
    brandIds.set(name, id);
  }

  const usedPrefixes = new Set<string>();
  const prefixByCategory = new Map<string, string>();
  for (const name of groceryCategories) {
    prefixByCategory.set(name, categoryPrefix(name, usedPrefixes));
  }
  const counters = new Map<string, number>();

  for (const item of groceryCatalog) {
    const prefix = prefixByCategory.get(item.category)!;
    const seq = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, seq);
    const shortCode = `${prefix}${String(seq).padStart(3, "0")}`;

    await createProduct(db, {
      storeId,
      name: item.name,
      nameTamil: null,
      shortCode,
      categoryId: categoryIds.get(item.category) ?? null,
      brandId: item.brand ? (brandIds.get(item.brand) ?? null) : null,
      uom: item.uom,
      isWeighted: item.isWeighted,
      hsnCode: item.hsnCode,
      taxRatePercent: item.taxRatePercent,
      barcodes: [],
      aliases: [],
      mrpPaise: Math.round(item.mrpRupees * 100),
      salePricePaise: Math.round(item.salePriceRupees * 100),
      costPricePaise: Math.round(item.costPriceRupees * 100),
      isTaxInclusive: true,
    });
  }

  return {
    categoriesCreated: categoryIds.size,
    brandsCreated: brandIds.size,
    productsCreated: groceryCatalog.length,
  };
}

/** Derives a short, unique 3-4 letter code per category for shortCode generation (e.g. "Rice & Grains" -> "RIC"). */
function categoryPrefix(category: string, used: Set<string>): string {
  const words = category.replace(/&/g, " ").split(/[\s,]+/).filter(Boolean);
  const [first, second] = words;
  let base = (first?.slice(0, 3) ?? "CAT").toUpperCase();
  if (used.has(base) && first && second) {
    base = (first.slice(0, 2) + second.slice(0, 2)).toUpperCase();
  }
  let candidate = base;
  let n = 1;
  while (used.has(candidate)) {
    candidate = `${base}${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}
