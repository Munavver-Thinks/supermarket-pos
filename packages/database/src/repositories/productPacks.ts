import type { ProductPackRow, ProductPricesInput } from "@pos/types";

import type { Db } from "../connection.js";

import { createProduct, ProductNotFoundError } from "./productsAdmin.js";

export class ParentIsAChildError extends Error {
  constructor() {
    super("A pack size can't be made from another pack size — only from the bulk product itself.");
    this.name = "ParentIsAChildError";
  }
}

/** Same rounding rule as @pos/business-logic's derivePackPrices — see productsAdmin.ts's copy
 * of this comment for why it's duplicated instead of imported. */
function derivePackPrices(parent: ProductPricesInput, packQty: number): ProductPricesInput {
  return {
    mrpPaise: Math.round(parent.mrpPaise * packQty),
    salePricePaise: Math.round(parent.salePricePaise * packQty),
    costPricePaise: Math.round(parent.costPricePaise * packQty),
    wholesalePricePaise:
      parent.wholesalePricePaise == null ? null : Math.round(parent.wholesalePricePaise * packQty),
    isTaxInclusive: parent.isTaxInclusive,
  };
}

export interface CreateChildProductInput {
  parentProductId: string;
  name: string;
  nameTamil: string | null;
  /** How much of the parent's uom one unit of this child represents (1 for "1kg" of a
   * kg-priced parent, 0.5 for "500g"). */
  packQty: number;
  barcodes: string[];
  aliases: string[];
  /** Omit to start linked, deriving from the parent's current price × packQty. Given, the
   * child starts unlinked with exactly these prices — the owner typed a deliberate price. */
  prices?: ProductPricesInput | undefined;
  reorderLevel?: number | undefined;
  audit?: { userId: string; deviceId: string | null } | undefined;
}

/**
 * Makes a new pack-size product from a bulk one — "Sugar 1kg" from "Sugar 50kg Bag". This
 * only creates the catalog entry and its starting price; it has no stock of its own until a
 * repack (see repack.ts) moves some of the parent's stock into it. One level only: a parent
 * that is itself a pack-size child is refused, so which price and which batch's expiry is the
 * real source stays unambiguous.
 */
export async function createChildProduct(db: Db, storeId: string, input: CreateChildProductInput): Promise<string> {
  const parent = await db
    .selectFrom("products")
    .leftJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "products.id").on("pp.effectiveTo", "is", null))
    .select([
      "products.storeId as storeId",
      "products.uom as uom",
      "products.hsnCode as hsnCode",
      "products.taxRatePercent as taxRatePercent",
      "products.supplierId as supplierId",
      "products.parentProductId as parentProductId",
      "pp.mrpPaise as mrpPaise",
      "pp.salePricePaise as salePricePaise",
      "pp.costPricePaise as costPricePaise",
      "pp.wholesalePricePaise as wholesalePricePaise",
      "pp.isTaxInclusive as isTaxInclusive",
    ])
    .where("products.id", "=", input.parentProductId)
    .executeTakeFirst();
  if (!parent || parent.storeId !== storeId) throw new ProductNotFoundError();
  if (parent.parentProductId !== null) throw new ParentIsAChildError();

  const linked = !input.prices;
  const prices =
    input.prices ??
    derivePackPrices(
      {
        mrpPaise: parent.mrpPaise ?? 0,
        salePricePaise: parent.salePricePaise ?? 0,
        costPricePaise: parent.costPricePaise ?? 0,
        wholesalePricePaise: parent.wholesalePricePaise ?? null,
        isTaxInclusive: parent.isTaxInclusive === 1,
      },
      input.packQty,
    );

  return createProduct(db, {
    storeId,
    name: input.name,
    nameTamil: input.nameTamil,
    shortCode: null,
    supplierId: parent.supplierId,
    // A pack a cashier picks off the shelf, counted whole — the weighing already happened
    // when it was made, not at the till.
    uom: "pcs",
    isWeighted: false,
    hsnCode: parent.hsnCode,
    taxRatePercent: parent.taxRatePercent,
    barcodes: input.barcodes,
    aliases: input.aliases,
    ...prices,
    reorderLevel: input.reorderLevel,
    audit: input.audit,
    parentProductId: input.parentProductId,
    packQty: input.packQty,
    priceLinkedToParent: linked,
  });
}

/** Every pack size of a bulk product, active or not, for display on the parent's own screen. */
export async function listChildren(db: Db, storeId: string, parentProductId: string): Promise<ProductPackRow[]> {
  const rows = await db
    .selectFrom("products as p")
    .leftJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null))
    .leftJoin("inventory as inv", (join) => join.onRef("inv.productId", "=", "p.id").on("inv.storeId", "=", storeId))
    .where("p.storeId", "=", storeId)
    .where("p.parentProductId", "=", parentProductId)
    .orderBy("p.packQty", "desc")
    .select([
      "p.id as id",
      "p.name as name",
      "p.packQty as packQty",
      "p.priceLinkedToParent as priceLinkedToParent",
      "pp.salePricePaise as salePricePaise",
      "pp.wholesalePricePaise as wholesalePricePaise",
      "inv.qtyOnHand as qtyOnHand",
      "p.isActive as isActive",
      "p.shelfLifeDays as shelfLifeDays",
      "p.rackLocation as rackLocation",
    ])
    .execute();

  return rows.map((r) => ({
    shelfLifeDays: r.shelfLifeDays,
    rackLocation: r.rackLocation,
    id: r.id,
    name: r.name,
    packQty: r.packQty ?? 0,
    priceLinkedToParent: r.priceLinkedToParent === 1,
    salePricePaise: r.salePricePaise ?? 0,
    wholesalePricePaise: r.wholesalePricePaise ?? null,
    qtyOnHand: r.qtyOnHand ?? 0,
    isActive: r.isActive === 1,
  }));
}
