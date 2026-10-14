import { randomUUID } from "node:crypto";

import type { ProductAdminRow, ProductDetailsInput, ProductForEdit, ProductPricesInput } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";
import { getPackBreakdownByParent, getPackStockByParent, setReorderLevel } from "./inventory.js";

export interface CreateProductInput {
  storeId: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  uom: string;
  isWeighted: boolean;
  hsnCode: string | null;
  taxRatePercent: number;
  barcodes: string[];
  aliases: string[];
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Omit or null for no wholesale rate. */
  wholesalePricePaise?: number | null | undefined;
  isTaxInclusive: boolean;
  /** Stock level at or below which the product shows as low. 0 = not set. */
  reorderLevel?: number | undefined;
  /**
   * Who is adding the product. Every product added through the app passes this; catalog
   * seeding and tests leave it out, since there is no person behind a bulk demo import.
   */
  audit?: { userId: string; deviceId: string | null } | undefined;
  /** Set only when this product is a pack-size child — see productPacks.ts, which is the
   * only caller that sets these three together. */
  parentProductId?: string | null | undefined;
  packQty?: number | null | undefined;
  priceLinkedToParent?: boolean | undefined;
  rackLocation?: string | null | undefined;
  shelfLifeDays?: number | null | undefined;
}

/** Who is making a change, and in which store — every admin write is checked against it. */
export interface ProductAuditActor {
  storeId: string;
  userId: string;
  deviceId: string | null;
}

/**
 * Barcodes are unique across the whole database (0001 put a plain UNIQUE on the column), so
 * a code held by any product — another store's, or one that was deactivated — blocks it.
 * Checked up front so the message names the product instead of a constraint failure.
 */
export class DuplicateBarcodeError extends Error {
  constructor(barcode: string, productName: string, isActive: boolean) {
    super(
      `Barcode ${barcode} already belongs to ${productName}${isActive ? "" : " (deactivated)"}. ` +
        "Remove it there first, or use a different code.",
    );
    this.name = "DuplicateBarcodeError";
  }
}

/** Short codes are typed at the counter, so two active products sharing one would be ambiguous. */
export class DuplicateShortCodeError extends Error {
  constructor(shortCode: string, productName: string) {
    super(`Short code ${shortCode} is already used by ${productName}.`);
    this.name = "DuplicateShortCodeError";
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("That product could not be found.");
    this.name = "ProductNotFoundError";
  }
}

async function assertBarcodesFree(trx: Db, barcodes: string[], exceptProductId: string | null): Promise<void> {
  if (barcodes.length === 0) return;
  let query = trx
    .selectFrom("productBarcodes as pb")
    .innerJoin("products as p", "p.id", "pb.productId")
    .where("pb.barcode", "in", barcodes)
    .select(["pb.barcode as barcode", "p.name as name", "p.isActive as isActive"]);
  if (exceptProductId) query = query.where("pb.productId", "!=", exceptProductId);
  const taken = await query.executeTakeFirst();
  if (taken) throw new DuplicateBarcodeError(taken.barcode, taken.name, taken.isActive === 1);
}

async function assertShortCodeFree(
  trx: Db,
  storeId: string,
  shortCode: string | null,
  exceptProductId: string | null,
): Promise<void> {
  if (!shortCode) return;
  let query = trx
    .selectFrom("products")
    .select("name")
    .where("storeId", "=", storeId)
    .where("shortCode", "=", shortCode)
    .where("isActive", "=", 1);
  if (exceptProductId) query = query.where("id", "!=", exceptProductId);
  const taken = await query.executeTakeFirst();
  if (taken) throw new DuplicateShortCodeError(shortCode, taken.name);
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

export async function createProduct(db: Db, input: CreateProductInput): Promise<string> {
  const productId = randomUUID();
  const barcodes = uniqueTrimmed(input.barcodes);

  await db.transaction().execute(async (trx) => {
    await assertBarcodesFree(trx, barcodes, null);
    await assertShortCodeFree(trx, input.storeId, input.shortCode, null);

    await trx
      .insertInto("products")
      .values({
        id: productId,
        storeId: input.storeId,
        name: input.name,
        nameTamil: input.nameTamil,
        shortCode: input.shortCode,
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        supplierId: input.supplierId ?? null,
        uom: input.uom,
        isWeighted: input.isWeighted ? 1 : 0,
        hsnCode: input.hsnCode,
        taxRatePercent: input.taxRatePercent,
        parentProductId: input.parentProductId ?? null,
        packQty: input.packQty ?? null,
        priceLinkedToParent: input.priceLinkedToParent ? 1 : 0,
        rackLocation: input.rackLocation ?? null,
        shelfLifeDays: input.shelfLifeDays ?? null,
      })
      .execute();

    for (const barcode of barcodes) {
      await trx
        .insertInto("productBarcodes")
        .values({ id: randomUUID(), productId, barcode, uom: input.uom })
        .execute();
    }

    for (const alias of input.aliases) {
      await trx
        .insertInto("productAliases")
        .values({ id: randomUUID(), productId, alias, aliasNormalized: normalizeAlias(alias) })
        .execute();
    }

    await trx
      .insertInto("productPrices")
      .values({
        id: randomUUID(),
        productId,
        mrpPaise: input.mrpPaise,
        salePricePaise: input.salePricePaise,
        costPricePaise: input.costPricePaise,
        wholesalePricePaise: input.wholesalePricePaise ?? null,
        isTaxInclusive: input.isTaxInclusive ? 1 : 0,
      })
      .execute();

    await trx
      .insertInto("inventory")
      .values({ productId, storeId: input.storeId, qtyOnHand: 0, reorderLevel: input.reorderLevel ?? 0 })
      .execute();

    if (input.audit) {
      await appendAuditLog(trx, {
        storeId: input.storeId,
        userId: input.audit.userId,
        deviceId: input.audit.deviceId,
        action: "product_created",
        tableName: "products",
        recordId: productId,
        oldValue: null,
        newValue: {
          name: input.name,
          mrpPaise: input.mrpPaise,
          salePricePaise: input.salePricePaise,
          costPricePaise: input.costPricePaise,
          taxRatePercent: input.taxRatePercent,
          hsnCode: input.hsnCode,
        },
        reason: null,
      });
    }
  });

  return productId;
}

/**
 * Must stay in lockstep with normalizeSearchText in @pos/business-logic — search builds its
 * LIKE pattern from that function, so a stored aliasNormalized that strips punctuation
 * differently would silently stop matching.
 */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function adminQuery(db: Db, storeId: string) {
  return db
    .selectFrom("products as p")
    .leftJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null))
    .leftJoin("inventory as inv", (join) => join.onRef("inv.productId", "=", "p.id").on("inv.storeId", "=", storeId))
    .leftJoin("suppliers as s", "s.id", "p.supplierId")
    .leftJoin("products as parent", "parent.id", "p.parentProductId")
    .where("p.storeId", "=", storeId)
    .select([
      "p.id as id",
      "p.name as name",
      "p.nameTamil as nameTamil",
      "p.shortCode as shortCode",
      "p.uom as uom",
      "p.isWeighted as isWeighted",
      "p.hsnCode as hsnCode",
      "p.taxRatePercent as taxRatePercent",
      "p.supplierId as supplierId",
      "p.parentProductId as parentProductId",
      "p.packQty as packQty",
      "p.priceLinkedToParent as priceLinkedToParent",
      "p.rackLocation as rackLocation",
      "p.shelfLifeDays as shelfLifeDays",
      "s.name as supplierName",
      "parent.name as parentName",
      "pp.mrpPaise as mrpPaise",
      "pp.salePricePaise as salePricePaise",
      "pp.costPricePaise as costPricePaise",
      "pp.wholesalePricePaise as wholesalePricePaise",
      "pp.isTaxInclusive as isTaxInclusive",
      "inv.qtyOnHand as qtyOnHand",
      "inv.reorderLevel as reorderLevel",
      "p.isActive as isActive",
    ]);
}

type AdminQueryRow = Awaited<ReturnType<ReturnType<typeof adminQuery>["execute"]>>[number];

async function barcodesFor(db: Db, productIds: string[]): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .selectFrom("productBarcodes")
    .select(["productId", "barcode"])
    .where("productId", "in", productIds)
    .orderBy("barcode")
    .execute();
  for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row.barcode]);
  return byProduct;
}

function toAdminRow(
  row: AdminQueryRow,
  barcodes: string[],
  packStockQty: number | null,
  packs: ProductAdminRow["packs"],
): ProductAdminRow {
  return {
    id: row.id,
    name: row.name,
    nameTamil: row.nameTamil,
    shortCode: row.shortCode,
    barcodes,
    uom: row.uom,
    isWeighted: row.isWeighted === 1,
    hsnCode: row.hsnCode,
    taxRatePercent: row.taxRatePercent,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    mrpPaise: row.mrpPaise ?? 0,
    salePricePaise: row.salePricePaise ?? 0,
    costPricePaise: row.costPricePaise ?? 0,
    wholesalePricePaise: row.wholesalePricePaise ?? null,
    isTaxInclusive: row.isTaxInclusive === 1,
    qtyOnHand: row.qtyOnHand ?? 0,
    reorderLevel: row.reorderLevel ?? 0,
    isActive: row.isActive === 1,
    parentProductId: row.parentProductId,
    packQty: row.packQty,
    priceLinkedToParent: row.priceLinkedToParent === 1,
    packStockQty,
    packs,
    parentName: row.parentName ?? null,
    rackLocation: row.rackLocation,
    shelfLifeDays: row.shelfLifeDays,
  };
}

/**
 * The Inventory products table. The query matches a name (English or Tamil), an exact short
 * code, or an exact barcode — the three things a shopkeeper has in hand.
 */
export async function listProductsForAdmin(
  db: Db,
  storeId: string,
  options: { query: string; includeInactive: boolean; limit: number },
): Promise<ProductAdminRow[]> {
  let query = adminQuery(db, storeId);
  if (!options.includeInactive) query = query.where("p.isActive", "=", 1);
  const text = options.query.trim();
  if (text) {
    const pattern = `%${text}%`;
    query = query.where((eb) =>
      eb.or([
        eb("p.name", "like", pattern),
        eb("p.nameTamil", "like", pattern),
        eb("p.shortCode", "=", text),
        eb.exists(
          eb
            .selectFrom("productBarcodes as b")
            .select("b.id")
            .whereRef("b.productId", "=", "p.id")
            .where("b.barcode", "=", text),
        ),
      ]),
    );
  }
  const rows = await query.orderBy("p.isActive", "desc").orderBy("p.name", "asc").limit(options.limit).execute();
  const barcodes = await barcodesFor(
    db,
    rows.map((r) => r.id),
  );
  const packStock = await getPackStockByParent(db, storeId);
  const packBreakdown = await getPackBreakdownByParent(db, storeId);
  return rows.map((r) =>
    toAdminRow(r, barcodes.get(r.id) ?? [], packStock.get(r.id) ?? null, packBreakdown.get(r.id) ?? null),
  );
}

export async function getProductForEdit(db: Db, productId: string): Promise<ProductForEdit | undefined> {
  const product = await db.selectFrom("products").select("storeId").where("id", "=", productId).executeTakeFirst();
  if (!product) return undefined;
  const row = await adminQuery(db, product.storeId).where("p.id", "=", productId).executeTakeFirst();
  if (!row) return undefined;
  const barcodes = await barcodesFor(db, [productId]);
  const aliases = await db
    .selectFrom("productAliases")
    .select("alias")
    .where("productId", "=", productId)
    .orderBy("alias")
    .execute();
  const packStock = await getPackStockByParent(db, product.storeId);
  const packBreakdown = await getPackBreakdownByParent(db, product.storeId);
  return {
    ...toAdminRow(row, barcodes.get(productId) ?? [], packStock.get(productId) ?? null, packBreakdown.get(productId) ?? null),
    storeId: product.storeId,
    aliases: aliases.map((a) => a.alias),
  };
}

function sameList(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Changes a product's details. Barcodes and other names are replaced as a whole; the reorder
 * level lives on the inventory row and is set there without moving stock. The audit entry
 * carries only the fields that changed (plus the name, for context).
 */
export async function updateProduct(
  db: Db,
  productId: string,
  details: ProductDetailsInput,
  actor: ProductAuditActor,
): Promise<ProductForEdit> {
  const barcodes = uniqueTrimmed(details.barcodes);
  const aliases = uniqueTrimmed(details.aliases);

  await db.transaction().execute(async (trx) => {
    const before = await getProductForEdit(trx, productId);
    if (!before || before.storeId !== actor.storeId) throw new ProductNotFoundError();

    await assertBarcodesFree(trx, barcodes, productId);
    await assertShortCodeFree(trx, actor.storeId, details.shortCode, productId);

    await trx
      .updateTable("products")
      .set({
        name: details.name,
        nameTamil: details.nameTamil,
        shortCode: details.shortCode,
        supplierId: details.supplierId,
        uom: details.uom,
        isWeighted: details.isWeighted ? 1 : 0,
        hsnCode: details.hsnCode,
        taxRatePercent: details.taxRatePercent,
        rackLocation: details.rackLocation,
        shelfLifeDays: details.shelfLifeDays,
      })
      .where("id", "=", productId)
      .execute();

    await trx.deleteFrom("productBarcodes").where("productId", "=", productId).execute();
    for (const barcode of barcodes) {
      await trx
        .insertInto("productBarcodes")
        .values({ id: randomUUID(), productId, barcode, uom: details.uom })
        .execute();
    }

    await trx.deleteFrom("productAliases").where("productId", "=", productId).execute();
    for (const alias of aliases) {
      await trx
        .insertInto("productAliases")
        .values({ id: randomUUID(), productId, alias, aliasNormalized: normalizeAlias(alias) })
        .execute();
    }

    if (before.reorderLevel !== details.reorderLevel) {
      await setReorderLevel(trx, actor.storeId, productId, details.reorderLevel);
    }

    const oldValue: Record<string, unknown> = { name: before.name };
    const newValue: Record<string, unknown> = { name: details.name };
    const scalar: Array<keyof ProductDetailsInput & keyof ProductForEdit> = [
      "nameTamil",
      "shortCode",
      "uom",
      "isWeighted",
      "hsnCode",
      "taxRatePercent",
      "reorderLevel",
      "supplierId",
      "rackLocation",
      "shelfLifeDays",
    ];
    for (const key of scalar) {
      if (before[key] !== details[key]) {
        oldValue[key] = before[key];
        newValue[key] = details[key];
      }
    }
    if (!sameList(before.barcodes, barcodes)) {
      oldValue.barcodes = before.barcodes;
      newValue.barcodes = barcodes;
    }
    if (!sameList(before.aliases, aliases)) {
      oldValue.aliases = before.aliases;
      newValue.aliases = aliases;
    }

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: "product_updated",
      tableName: "products",
      recordId: productId,
      oldValue,
      newValue,
      reason: null,
    });
  });

  const after = await getProductForEdit(db, productId);
  if (!after) throw new ProductNotFoundError();
  return after;
}

/**
 * A child's price derived from its parent's, rounded to the nearest paisa — same rule as
 * @pos/business-logic's derivePackPrices, duplicated rather than imported: this package
 * can't load business-logic at runtime (see stockBatches.ts). Keep the two in step.
 */
function derivePackPrices(parent: ProductPricesInput, packQty: number): ProductPricesInput {
  return {
    mrpPaise: Math.round(parent.mrpPaise * packQty),
    salePricePaise: Math.round(parent.salePricePaise * packQty),
    costPricePaise: Math.round(parent.costPricePaise * packQty),
    // No wholesale rate on the parent means none on the child either — never derived from 0.
    wholesalePricePaise:
      parent.wholesalePricePaise == null ? null : Math.round(parent.wholesalePricePaise * packQty),
    isTaxInclusive: parent.isTaxInclusive,
  };
}

/** Writes one new effective-dated price row and its audit entry. The actual mutation shared
 * by a direct price edit and a cascaded one — callers decide what, if anything, to do about
 * priceLinkedToParent. Returns false, writing nothing, when the prices are unchanged. */
async function insertPriceRow(
  trx: Db,
  productId: string,
  productName: string,
  prices: ProductPricesInput,
  actor: ProductAuditActor,
): Promise<boolean> {
  const current = await trx
    .selectFrom("productPrices")
    .selectAll()
    .where("productId", "=", productId)
    .where("effectiveTo", "is", null)
    .executeTakeFirst();

  const isTaxInclusive = prices.isTaxInclusive ? 1 : 0;
  const wholesalePricePaise = prices.wholesalePricePaise ?? null;
  if (
    current &&
    current.mrpPaise === prices.mrpPaise &&
    current.salePricePaise === prices.salePricePaise &&
    current.costPricePaise === prices.costPricePaise &&
    current.wholesalePricePaise === wholesalePricePaise &&
    current.isTaxInclusive === isTaxInclusive
  ) {
    return false;
  }

  const now = new Date().toISOString();
  if (current) {
    await trx.updateTable("productPrices").set({ effectiveTo: now }).where("id", "=", current.id).execute();
  }
  await trx
    .insertInto("productPrices")
    .values({
      id: randomUUID(),
      productId,
      mrpPaise: prices.mrpPaise,
      salePricePaise: prices.salePricePaise,
      costPricePaise: prices.costPricePaise,
      wholesalePricePaise,
      isTaxInclusive,
      effectiveFrom: now,
      effectiveTo: null,
    })
    .execute();

  await appendAuditLog(trx, {
    storeId: actor.storeId,
    userId: actor.userId,
    deviceId: actor.deviceId,
    action: "product_price_changed",
    tableName: "product_prices",
    recordId: productId,
    oldValue: current
      ? {
          mrpPaise: current.mrpPaise,
          salePricePaise: current.salePricePaise,
          costPricePaise: current.costPricePaise,
          wholesalePricePaise: current.wholesalePricePaise,
          isTaxInclusive: current.isTaxInclusive === 1,
        }
      : null,
    newValue: { name: productName, ...prices, wholesalePricePaise },
    reason: null,
  });
  return true;
}

/** Every pack-size child still following this product's price, recalculated and written in
 * the same transaction as the parent's own change — a price only ever flows one way, parent
 * to child, and a child that has been edited directly (priceLinkedToParent false) is skipped.
 * Exported: purchases.ts also calls this, to cascade a weighted-average cost update from a
 * receipt on a parent product down to its linked pack-size children. */
export async function cascadeLinkedChildPrices(
  trx: Db,
  parentId: string,
  parentPrices: ProductPricesInput,
  actor: ProductAuditActor,
): Promise<void> {
  const children = await trx
    .selectFrom("products")
    .select(["id", "name", "packQty"])
    .where("parentProductId", "=", parentId)
    .where("priceLinkedToParent", "=", 1)
    .execute();

  for (const child of children) {
    if (child.packQty === null) continue; // Shouldn't happen for a real child; defensive.
    await insertPriceRow(trx, child.id, child.name, derivePackPrices(parentPrices, child.packQty), actor);
  }
}

/**
 * Sets new prices from now on. The open price row is closed and a new one opened, never
 * overwritten — old bills and the profit report keep the cost that applied when each sale
 * happened. Returns false, writing nothing, when the prices are unchanged.
 *
 * For a bulk product this also recalculates every pack-size child still linked to it, in the
 * same transaction. For a pack-size child itself, this is a direct edit of its own price —
 * which is exactly what takes it off the parent's price from now on, so the link is turned
 * off as part of the same write (see relinkChildPrice to turn it back on).
 */
export async function changeProductPrices(
  db: Db,
  productId: string,
  prices: ProductPricesInput,
  actor: ProductAuditActor,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom("products")
      .select(["storeId", "name", "parentProductId"])
      .where("id", "=", productId)
      .executeTakeFirst();
    if (!product || product.storeId !== actor.storeId) throw new ProductNotFoundError();

    const changed = await insertPriceRow(trx, productId, product.name, prices, actor);
    if (!changed) return false;

    if (product.parentProductId) {
      await trx.updateTable("products").set({ priceLinkedToParent: 0 }).where("id", "=", productId).execute();
    } else {
      await cascadeLinkedChildPrices(trx, productId, prices, actor);
    }
    return true;
  });
}

export class NotAPackChildError extends Error {
  constructor() {
    super("That product is not a pack size of another product.");
    this.name = "NotAPackChildError";
  }
}

/**
 * Turns a child's price link back on and immediately recalculates it from the parent's
 * current price — the only way back in, once a direct edit has turned it off.
 */
export async function relinkChildPrice(db: Db, childId: string, actor: ProductAuditActor): Promise<ProductForEdit> {
  await db.transaction().execute(async (trx) => {
    const child = await trx
      .selectFrom("products")
      .select(["storeId", "name", "parentProductId", "packQty"])
      .where("id", "=", childId)
      .executeTakeFirst();
    if (!child || child.storeId !== actor.storeId) throw new ProductNotFoundError();
    if (!child.parentProductId || child.packQty === null) throw new NotAPackChildError();

    const parentPrice = await trx
      .selectFrom("productPrices")
      .selectAll()
      .where("productId", "=", child.parentProductId)
      .where("effectiveTo", "is", null)
      .executeTakeFirst();
    if (!parentPrice) throw new ProductNotFoundError();

    const derived = derivePackPrices(
      {
        mrpPaise: parentPrice.mrpPaise,
        salePricePaise: parentPrice.salePricePaise,
        costPricePaise: parentPrice.costPricePaise,
        wholesalePricePaise: parentPrice.wholesalePricePaise,
        isTaxInclusive: parentPrice.isTaxInclusive === 1,
      },
      child.packQty,
    );
    await insertPriceRow(trx, childId, child.name, derived, actor);
    await trx.updateTable("products").set({ priceLinkedToParent: 1 }).where("id", "=", childId).execute();
  });

  const after = await getProductForEdit(db, childId);
  if (!after) throw new ProductNotFoundError();
  return after;
}

/**
 * Takes a product out of billing (or brings it back). Nothing is deleted: old bills,
 * stock and price history stay as they were. Returns false when it was already so.
 */
export async function setProductActive(
  db: Db,
  productId: string,
  isActive: boolean,
  actor: ProductAuditActor,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom("products")
      .select(["storeId", "name", "isActive"])
      .where("id", "=", productId)
      .executeTakeFirst();
    if (!product || product.storeId !== actor.storeId) throw new ProductNotFoundError();
    if ((product.isActive === 1) === isActive) return false;

    await trx
      .updateTable("products")
      .set({ isActive: isActive ? 1 : 0 })
      .where("id", "=", productId)
      .execute();

    await appendAuditLog(trx, {
      storeId: actor.storeId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      action: isActive ? "product_reactivated" : "product_deactivated",
      tableName: "products",
      recordId: productId,
      oldValue: { name: product.name, isActive: product.isActive === 1 },
      newValue: { name: product.name, isActive },
      reason: null,
    });
    return true;
  });
}
