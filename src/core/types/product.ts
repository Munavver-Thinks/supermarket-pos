export interface Category {
  id: string;
  storeId: string;
  name: string;
  parentId: string | null;
}

export interface Brand {
  id: string;
  storeId: string;
  name: string;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  categoryId: string | null;
  brandId: string | null;
  supplierId: string | null;
  uom: string;
  isWeighted: boolean;
  hsnCode: string | null;
  taxRatePercent: number;
  isActive: boolean;
  createdAt: string;
}

export interface ProductBarcode {
  id: string;
  productId: string;
  barcode: string;
  uom: string;
}

export interface ProductAlias {
  id: string;
  productId: string;
  alias: string;
}

export interface ProductPrice {
  id: string;
  productId: string;
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  isTaxInclusive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Denormalized shape returned by the search engine — everything the billing screen needs in one row. */
export interface ProductSearchResult {
  productId: string;
  name: string;
  nameTamil: string | null;
  uom: string;
  isWeighted: boolean;
  barcode: string | null;
  salePricePaise: number;
  mrpPaise: number;
  /** Null means no wholesale rate is set for this product. See cartStore.ts's addProduct. */
  wholesalePricePaise: number | null;
  isTaxInclusive: boolean;
  taxRatePercent: number;
  stockOnHand: number;
  matchType:
    | "barcode"
    | "short_code"
    | "alias_exact"
    | "name_exact"
    | "prefix"
    | "fuzzy"
    | "browse";
  matchScore: number;
}

/** One row of the Inventory products table, active or not. */
export interface ProductAdminRow {
  id: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  barcodes: string[];
  uom: string;
  isWeighted: boolean;
  hsnCode: string | null;
  taxRatePercent: number;
  supplierId: string | null;
  supplierName: string | null;
  /** The open price row; 0 for a product that somehow has none. */
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Null means no wholesale rate is set for this product. */
  wholesalePricePaise: number | null;
  isTaxInclusive: boolean;
  qtyOnHand: number;
  reorderLevel: number;
  isActive: boolean;
  /** Set only on a pack-size child, e.g. "Sugar 1kg" pointing at "Sugar 50kg Bag". */
  parentProductId: string | null;
  /** How much of the parent's uom one unit of this child represents. Null for anything that
   * isn't a child. */
  packQty: number | null;
  /** Whether this child's price follows the parent's automatically. Meaningless for anything
   * that isn't a child. */
  priceLinkedToParent: boolean;
  /** Stock held in this product's pack sizes, in this product's own uom (Σ child qtyOnHand ×
   * packQty, every child, active or not). Null when the product has no pack sizes; always
   * null on a child. */
  packStockQty: number | null;
  /** Per-size breakdown of the same pack stock, biggest pack first. Null when the product has
   * no pack sizes. */
  packs: Array<{ name: string; packQty: number; qtyOnHand: number }> | null;
  /** The bulk product's name; set only on a pack-size child. */
  parentName: string | null;
  /** Where the product sits in the shop ("B-3"). Shown in the app only, never on a label. */
  rackLocation: string | null;
  /** Days a pack made in-store stays good; the default best-before when repacking. */
  shelfLifeDays: number | null;
}

/** Everything the edit form needs, including the other names billing search matches on. */
export interface ProductForEdit extends ProductAdminRow {
  storeId: string;
  aliases: string[];
}

/** One pack-size child of a bulk product, as shown on the parent's own screen. */
export interface ProductPackRow {
  id: string;
  name: string;
  packQty: number;
  priceLinkedToParent: boolean;
  salePricePaise: number;
  wholesalePricePaise: number | null;
  qtyOnHand: number;
  isActive: boolean;
  shelfLifeDays: number | null;
  rackLocation: string | null;
}

/** The editable details of a product. Prices are changed separately, because they are effective-dated. */
export interface ProductDetailsInput {
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  supplierId: string | null;
  uom: string;
  isWeighted: boolean;
  hsnCode: string | null;
  taxRatePercent: number;
  barcodes: string[];
  aliases: string[];
  reorderLevel: number;
  rackLocation: string | null;
  shelfLifeDays: number | null;
}

export interface ProductPricesInput {
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Omit or null for no wholesale rate — the product just sells at salePricePaise, even on a
   * bill marked wholesale. Optional so existing callers that don't set one still typecheck. */
  wholesalePricePaise?: number | null | undefined;
  isTaxInclusive: boolean;
}
