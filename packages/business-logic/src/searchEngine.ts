import Fuse from "fuse.js";
import type { ProductSearchResult } from "@pos/types";

/**
 * Normalizes cashier input for matching: lowercase, trim, collapse whitespace, strip
 * punctuation. Used both when storing `alias_normalized` and when matching a query
 * against it, so Tanglish/misspelled input compares consistently.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

export interface SearchableCandidate {
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
 * Classifies and ranks already-fetched candidates (alias/name LIKE matches from the DB
 * layer) per the documented search priority: exact alias > exact name > prefix > fuzzy.
 * Barcode and short-code (SKU) matches are exact single-row lookups handled upstream by
 * the caller and never reach this function.
 */
export function rankProducts(rawQuery: string, candidates: SearchableCandidate[]): ProductSearchResult[] {
  const query = normalizeSearchText(rawQuery);
  if (query.length === 0) return [];

  const best = new Map<string, ProductSearchResult>();

  for (const candidate of candidates) {
    const normalizedName = normalizeSearchText(candidate.name);
    const normalizedAlias = candidate.matchedAlias ? normalizeSearchText(candidate.matchedAlias) : null;

    let matchType: ProductSearchResult["matchType"];
    let matchScore: number;

    if (normalizedAlias === query) {
      matchType = "alias_exact";
      matchScore = 100;
    } else if (normalizedName === query) {
      matchType = "name_exact";
      matchScore = 95;
    } else if (normalizedAlias?.startsWith(query)) {
      matchType = "prefix";
      matchScore = 80;
    } else if (normalizedName.startsWith(query)) {
      matchType = "prefix";
      matchScore = 75;
    } else {
      matchType = "fuzzy";
      matchScore = 40;
    }

    const result: ProductSearchResult = {
      productId: candidate.productId,
      name: candidate.name,
      nameTamil: candidate.nameTamil,
      uom: candidate.uom,
      isWeighted: candidate.isWeighted === 1,
      barcode: candidate.barcode,
      salePricePaise: candidate.salePricePaise,
      mrpPaise: candidate.mrpPaise,
      wholesalePricePaise: candidate.wholesalePricePaise,
      isTaxInclusive: candidate.isTaxInclusive === 1,
      taxRatePercent: candidate.taxRatePercent,
      stockOnHand: candidate.stockOnHand,
      matchType,
      matchScore,
    };

    const existing = best.get(candidate.productId);
    if (!existing || existing.matchScore < matchScore) {
      best.set(candidate.productId, result);
    }
  }

  return [...best.values()].sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Fuzzy fallback over a full in-memory product cache, used only when the exact/prefix
 * stages return nothing — per the "AI should not be called for every keystroke" rule,
 * this stays cheap client-side fuzzy matching, not a semantic/AI call.
 */
export function fuzzySearchProducts(
  rawQuery: string,
  allProducts: SearchableCandidate[],
  limit = 15,
): ProductSearchResult[] {
  const fuse = new Fuse(allProducts, {
    keys: ["name", "nameTamil", "shortCode"],
    threshold: 0.4,
    includeScore: true,
  });

  return fuse
    .search(rawQuery, { limit })
    .map(({ item, score }) => ({
      productId: item.productId,
      name: item.name,
      nameTamil: item.nameTamil,
      uom: item.uom,
      isWeighted: item.isWeighted === 1,
      barcode: item.barcode,
      salePricePaise: item.salePricePaise,
      mrpPaise: item.mrpPaise,
      wholesalePricePaise: item.wholesalePricePaise,
      isTaxInclusive: item.isTaxInclusive === 1,
      taxRatePercent: item.taxRatePercent,
      stockOnHand: item.stockOnHand,
      matchType: "fuzzy" as const,
      matchScore: Math.round((1 - (score ?? 1)) * 60),
    }));
}
