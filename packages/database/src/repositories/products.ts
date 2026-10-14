import { sql } from "kysely";

import type { Db } from "../connection.js";

export interface ProductCandidateRow {
  productId: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  uom: string;
  isWeighted: number;
  taxRatePercent: number;
  barcode: string | null;
  matchedAlias: string | null;
  salePricePaise: number;
  mrpPaise: number;
  wholesalePricePaise: number | null;
  isTaxInclusive: number;
  stockOnHand: number;
}

/**
 * The base of every billing lookup below. The isActive filter here is what keeps a
 * deactivated product out of scanning, short codes, search, the offline cache and browsing
 * alike — anything added to this file should build on it.
 */
const CANDIDATE_SELECT = (db: Db, storeId: string) =>
  db
    .selectFrom("products as p")
    .innerJoin("productPrices as pp", (join) =>
      join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null),
    )
    .leftJoin("inventory as inv", (join) =>
      join.onRef("inv.productId", "=", "p.id").on("inv.storeId", "=", storeId),
    )
    .leftJoin("productBarcodes as pb", "pb.productId", "p.id")
    .where("p.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .select([
      "p.id as productId",
      "p.name as name",
      "p.nameTamil as nameTamil",
      "p.shortCode as shortCode",
      "p.uom as uom",
      "p.isWeighted as isWeighted",
      "p.taxRatePercent as taxRatePercent",
      "pb.barcode as barcode",
      "pp.salePricePaise as salePricePaise",
      "pp.mrpPaise as mrpPaise",
      "pp.wholesalePricePaise as wholesalePricePaise",
      "pp.isTaxInclusive as isTaxInclusive",
      "inv.qtyOnHand as stockOnHand",
    ]);

export async function findByBarcode(
  db: Db,
  storeId: string,
  barcode: string,
): Promise<ProductCandidateRow | undefined> {
  const row = await CANDIDATE_SELECT(db, storeId)
    .where("pb.barcode", "=", barcode)
    .executeTakeFirst();
  return row ? { ...row, matchedAlias: null, stockOnHand: row.stockOnHand ?? 0 } : undefined;
}

export async function findByShortCode(
  db: Db,
  storeId: string,
  shortCode: string,
): Promise<ProductCandidateRow | undefined> {
  const row = await CANDIDATE_SELECT(db, storeId)
    .where("p.shortCode", "=", shortCode)
    .executeTakeFirst();
  return row ? { ...row, matchedAlias: null, stockOnHand: row.stockOnHand ?? 0 } : undefined;
}

/** Broad candidate fetch for the fuzzy/alias/prefix search stages — ranking happens in @pos/business-logic. */
export async function searchCandidates(
  db: Db,
  storeId: string,
  normalizedQuery: string,
  limit = 50,
): Promise<ProductCandidateRow[]> {
  const likePattern = `%${normalizedQuery}%`;

  const byAlias = await CANDIDATE_SELECT(db, storeId)
    .innerJoin("productAliases as pa", "pa.productId", "p.id")
    .where("pa.aliasNormalized", "like", likePattern)
    .select(["pa.alias as matchedAlias"])
    .limit(limit)
    .execute();

  const byName = await CANDIDATE_SELECT(db, storeId)
    .where("p.name", "like", likePattern)
    .select(sql<string | null>`NULL`.as("matchedAlias"))
    .limit(limit)
    .execute();

  const seen = new Set<string>();
  const combined: ProductCandidateRow[] = [];
  for (const row of [...byAlias, ...byName]) {
    const key = `${row.productId}:${row.matchedAlias ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push({ ...row, stockOnHand: row.stockOnHand ?? 0 });
  }
  return combined;
}

export async function getAllActiveForCache(db: Db, storeId: string): Promise<ProductCandidateRow[]> {
  const rows = await CANDIDATE_SELECT(db, storeId).execute();
  return rows.map((row) => ({ ...row, matchedAlias: null, stockOnHand: row.stockOnHand ?? 0 }));
}

/** Alphabetical, capped product listing for the billing search panel before the cashier types anything. */
export async function listForBrowse(db: Db, storeId: string, limit = 30): Promise<ProductCandidateRow[]> {
  const rows = await CANDIDATE_SELECT(db, storeId).orderBy("p.name", "asc").limit(limit).execute();
  return rows.map((row) => ({ ...row, matchedAlias: null, stockOnHand: row.stockOnHand ?? 0 }));
}

/**
 * Of the given products, those that can't be sold: deactivated, or not found in this store.
 * Every lookup above already hides inactive products; this is the check at payment time for
 * a held bill that picked one up before it was deactivated.
 */
export async function getUnsellableProductIds(db: Db, storeId: string, productIds: string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  const active = await db
    .selectFrom("products")
    .select("id")
    .where("storeId", "=", storeId)
    .where("isActive", "=", 1)
    .where("id", "in", productIds)
    .execute();
  const activeIds = new Set(active.map((r) => r.id));
  return [...new Set(productIds)].filter((id) => !activeIds.has(id));
}

/** Cost price per product, used only for the below-cost discount guard — never sent to the renderer. */
export async function getCostPrices(db: Db, productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .selectFrom("productPrices")
    .select(["productId", "costPricePaise"])
    .where("productId", "in", productIds)
    .where("effectiveTo", "is", null)
    .execute();

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.productId] = row.costPricePaise;
  }
  return result;
}
