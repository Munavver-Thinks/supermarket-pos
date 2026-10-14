import type { GstRateRow, HsnSummaryRow, SalesReport, StockValuationRow, TopProductRow } from "@pos/types";

import type { Db } from "../connection.js";

export interface DateRange {
  /** Inclusive ISO instant. */
  fromIso: string;
  /** Exclusive ISO instant — callers pass the start of the day after the range ends. */
  toIso: string;
}

/**
 * Headline sales figures for a date range, with returns netted off.
 *
 * Netting is the whole point: a report that counts bills but ignores credit notes
 * overstates both revenue and tax owed, and the tax figure is the one that gets filed.
 */
export async function getSalesReport(db: Db, storeId: string, range: DateRange): Promise<SalesReport> {
  const sales = await db
    .selectFrom("sales")
    .select(["id", "grossPaise", "discountPaise", "taxablePaise", "cgstPaise", "sgstPaise", "netPaise"])
    .where("storeId", "=", storeId)
    .where("status", "=", "completed")
    .where("createdAt", ">=", range.fromIso)
    .where("createdAt", "<", range.toIso)
    .execute();

  const returns = await db
    .selectFrom("saleReturns")
    .select((eb) => [
      eb.fn.sum<number | null>("refundPaise").as("refundPaise"),
      eb.fn.sum<number | null>("taxablePaise").as("taxablePaise"),
      eb.fn.sum<number | null>("cgstPaise").as("cgstPaise"),
      eb.fn.sum<number | null>("sgstPaise").as("sgstPaise"),
      eb.fn.countAll().as("count"),
    ])
    .where("storeId", "=", storeId)
    .where("createdAt", ">=", range.fromIso)
    .where("createdAt", "<", range.toIso)
    .executeTakeFirst();

  const paymentRows =
    sales.length === 0
      ? []
      : await db
          .selectFrom("payments")
          .select(["mode"])
          .select((eb) => eb.fn.sum<number | null>("amountPaise").as("amountPaise"))
          .where(
            "saleId",
            "in",
            sales.map((s) => s.id),
          )
          .groupBy("mode")
          .execute();

  const refundPaise = Number(returns?.refundPaise ?? 0);

  return {
    billCount: sales.length,
    returnCount: Number(returns?.count ?? 0),
    grossPaise: sales.reduce((sum, s) => sum + s.grossPaise, 0),
    discountPaise: sales.reduce((sum, s) => sum + s.discountPaise, 0),
    taxablePaise: sales.reduce((sum, s) => sum + s.taxablePaise, 0) - Number(returns?.taxablePaise ?? 0),
    cgstPaise: sales.reduce((sum, s) => sum + s.cgstPaise, 0) - Number(returns?.cgstPaise ?? 0),
    sgstPaise: sales.reduce((sum, s) => sum + s.sgstPaise, 0) - Number(returns?.sgstPaise ?? 0),
    refundPaise,
    netPaise: sales.reduce((sum, s) => sum + s.netPaise, 0) - refundPaise,
    paymentMix: paymentRows.map((p) => ({
      mode: p.mode as SalesReport["paymentMix"][number]["mode"],
      amountPaise: Number(p.amountPaise ?? 0),
    })),
  };
}

/**
 * Rate-wise taxable value and tax for the range — the table a GSTR-1 return is filled in
 * from. Returns are subtracted at the rate they were originally sold at, which is why the
 * credit-note query joins back through sale_items rather than reading a rate of its own.
 */
export async function getGstSummary(db: Db, storeId: string, range: DateRange): Promise<GstRateRow[]> {
  const sold = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", range.fromIso)
    .where("s.createdAt", "<", range.toIso)
    .groupBy("si.taxRatePercent")
    .select(["si.taxRatePercent as taxRatePercent"])
    .select((eb) => [
      eb.fn.sum<number | null>("si.taxablePaise").as("taxablePaise"),
      eb.fn.sum<number | null>("si.cgstPaise").as("cgstPaise"),
      eb.fn.sum<number | null>("si.sgstPaise").as("sgstPaise"),
    ])
    .execute();

  const returned = await db
    .selectFrom("saleReturnItems as sri")
    .innerJoin("saleReturns as r", "r.id", "sri.returnId")
    .innerJoin("saleItems as si", "si.id", "sri.saleItemId")
    .where("r.storeId", "=", storeId)
    .where("r.createdAt", ">=", range.fromIso)
    .where("r.createdAt", "<", range.toIso)
    .groupBy("si.taxRatePercent")
    .select(["si.taxRatePercent as taxRatePercent"])
    .select((eb) => [
      eb.fn.sum<number | null>("sri.taxablePaise").as("taxablePaise"),
      eb.fn.sum<number | null>("sri.cgstPaise").as("cgstPaise"),
      eb.fn.sum<number | null>("sri.sgstPaise").as("sgstPaise"),
    ])
    .execute();

  const byRate = new Map<number, GstRateRow>();
  for (const row of sold) {
    byRate.set(row.taxRatePercent, {
      taxRatePercent: row.taxRatePercent,
      taxablePaise: Number(row.taxablePaise ?? 0),
      cgstPaise: Number(row.cgstPaise ?? 0),
      sgstPaise: Number(row.sgstPaise ?? 0),
      totalTaxPaise: 0,
    });
  }
  for (const row of returned) {
    const existing = byRate.get(row.taxRatePercent) ?? {
      taxRatePercent: row.taxRatePercent,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalTaxPaise: 0,
    };
    existing.taxablePaise -= Number(row.taxablePaise ?? 0);
    existing.cgstPaise -= Number(row.cgstPaise ?? 0);
    existing.sgstPaise -= Number(row.sgstPaise ?? 0);
    byRate.set(row.taxRatePercent, existing);
  }

  return [...byRate.values()]
    .map((r) => ({ ...r, totalTaxPaise: r.cgstPaise + r.sgstPaise }))
    .sort((a, b) => a.taxRatePercent - b.taxRatePercent);
}

/**
 * HSN-wise summary, the other table GSTR-1 asks for. Products with no HSN code are grouped
 * under a blank code rather than dropped — a missing code is something the shopkeeper needs
 * to see and fix, not something a report should hide.
 */
export async function getHsnSummary(db: Db, storeId: string, range: DateRange): Promise<HsnSummaryRow[]> {
  const rows = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", range.fromIso)
    .where("s.createdAt", "<", range.toIso)
    .groupBy(["p.hsnCode", "si.taxRatePercent"])
    .select(["p.hsnCode as hsnCode", "si.taxRatePercent as taxRatePercent"])
    .select((eb) => [
      eb.fn.sum<number | null>("si.qty").as("qty"),
      eb.fn.sum<number | null>("si.taxablePaise").as("taxablePaise"),
      eb.fn.sum<number | null>("si.cgstPaise").as("cgstPaise"),
      eb.fn.sum<number | null>("si.sgstPaise").as("sgstPaise"),
    ])
    .execute();

  return rows
    .map((r) => ({
      hsnCode: r.hsnCode,
      taxRatePercent: r.taxRatePercent,
      qty: Number(r.qty ?? 0),
      taxablePaise: Number(r.taxablePaise ?? 0),
      cgstPaise: Number(r.cgstPaise ?? 0),
      sgstPaise: Number(r.sgstPaise ?? 0),
    }))
    .sort((a, b) => (a.hsnCode ?? "").localeCompare(b.hsnCode ?? ""));
}

/** Best sellers for the range, by money taken. */
export async function getTopProducts(
  db: Db,
  storeId: string,
  range: DateRange,
  limit: number,
): Promise<TopProductRow[]> {
  const rows = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", range.fromIso)
    .where("s.createdAt", "<", range.toIso)
    .groupBy(["si.productId", "p.name", "p.uom"])
    .select(["si.productId as productId", "p.name as name", "p.uom as uom"])
    .select((eb) => [
      eb.fn.sum<number | null>("si.qty").as("qty"),
      eb.fn.sum<number | null>("si.lineTotalPaise").as("revenuePaise"),
    ])
    .orderBy((eb) => eb.fn.sum("si.lineTotalPaise"), "desc")
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    uom: r.uom,
    qty: Number(r.qty ?? 0),
    revenuePaise: Number(r.revenuePaise ?? 0),
  }));
}

/**
 * What the stock on the shelves is worth at its current cost price. The cost price itself is
 * now a weighted average of stock already on hand and whatever's been received since (see
 * purchases.ts's recordNewCostPrice), so this plain costPricePaise × qtyOnHand stays correct
 * without needing to know about batches or receipt history. Products with no open cost price
 * count as zero rather than being excluded, so the quantity column still adds up to the whole
 * shop.
 */
export async function getStockValuation(db: Db, storeId: string): Promise<StockValuationRow[]> {
  const rows = await db
    .selectFrom("inventory as inv")
    .innerJoin("products as p", "p.id", "inv.productId")
    .leftJoin("productPrices as pp", (join) =>
      join.onRef("pp.productId", "=", "inv.productId").on("pp.effectiveTo", "is", null),
    )
    .where("inv.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .select([
      "p.id as productId",
      "p.name as name",
      "p.uom as uom",
      "inv.qtyOnHand as qtyOnHand",
      "pp.costPricePaise as costPricePaise",
      "pp.salePricePaise as salePricePaise",
    ])
    .execute();

  return rows
    .map((r) => {
      const costPricePaise = r.costPricePaise ?? 0;
      return {
        productId: r.productId,
        name: r.name,
        uom: r.uom,
        qtyOnHand: r.qtyOnHand,
        costPricePaise,
        salePricePaise: r.salePricePaise ?? 0,
        valuePaise: Math.round(costPricePaise * r.qtyOnHand),
      };
    })
    .sort((a, b) => b.valuePaise - a.valuePaise);
}
