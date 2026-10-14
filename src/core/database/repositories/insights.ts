import type { CurrentPriceRow } from "@pos/business-logic";
import type {
  DashboardSummary,
  DeadStockRow,
  ExpiringBatchRow,
  ProfitReport,
  ProfitReportRow,
  SalesSummary,
  SlowMovingRow,
} from "@pos/types";

import type { Db } from "../connection.js";

import { getLowStock } from "./inventory.js";
import type { DateRange } from "./reports.js";
import { listExpiring } from "./stockBatches.js";

/**
 * Profit, stock-movement and dashboard figures.
 *
 * Cost of goods rule: a unit sold is costed at the product_prices row in effect when the bill
 * was made — effective_from ≤ sale time and (effective_to is null or later than it). If no
 * row covers that moment (a sale older than the product's first recorded price), the earliest
 * row is used. A product with no cost recorded counts as zero cost and is flagged, never
 * guessed. This only holds because prices are effective-dated and never overwritten; every
 * price change (purchases, product edits) closes the old row and opens a new one.
 *
 * Returns are netted: the returned quantity and taxable value come off, costed at the time of
 * the original sale.
 */

const DAY_MS = 86_400_000;

type CostRow = { from: string; to: string | null; cost: number };

async function costHistory(db: Db, productIds: string[]): Promise<Map<string, CostRow[]>> {
  const byProduct = new Map<string, CostRow[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .selectFrom("productPrices")
    .select(["productId", "effectiveFrom", "effectiveTo", "costPricePaise"])
    .where("productId", "in", productIds)
    .orderBy("effectiveFrom", "asc")
    .execute();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push({ from: r.effectiveFrom, to: r.effectiveTo, cost: r.costPricePaise });
    byProduct.set(r.productId, list);
  }
  return byProduct;
}

/** Unit cost in effect at `atIso`, or null when the product has no price rows at all. */
function costAt(history: CostRow[] | undefined, atIso: string): number | null {
  if (!history || history.length === 0) return null;
  const match = history.find((h) => h.from <= atIso && (h.to === null || h.to > atIso));
  return (match ?? history[0])?.cost ?? null;
}

/** Same formula as marginPercent in business-logic: profit over revenue, one decimal. */
function percent(revenuePaise: number, profitPaise: number): number | null {
  if (revenuePaise <= 0) return null;
  return Math.round((profitPaise / revenuePaise) * 1000) / 10;
}

export async function getProfitReport(db: Db, storeId: string, range: DateRange): Promise<ProfitReport> {
  const sold = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .innerJoin("products as p", "p.id", "si.productId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", range.fromIso)
    .where("s.createdAt", "<", range.toIso)
    .select([
      "si.productId as productId",
      "p.name as name",
      "p.uom as uom",
      "si.qty as qty",
      "si.taxablePaise as taxablePaise",
      "s.createdAt as soldAt",
    ])
    .execute();

  const returned = await db
    .selectFrom("saleReturnItems as ri")
    .innerJoin("saleReturns as r", "r.id", "ri.returnId")
    .innerJoin("sales as s", "s.id", "r.saleId")
    .innerJoin("products as p", "p.id", "ri.productId")
    .where("r.storeId", "=", storeId)
    .where("r.createdAt", ">=", range.fromIso)
    .where("r.createdAt", "<", range.toIso)
    .select([
      "ri.productId as productId",
      "p.name as name",
      "p.uom as uom",
      "ri.qty as qty",
      "ri.taxablePaise as taxablePaise",
      "s.createdAt as soldAt",
    ])
    .execute();

  const history = await costHistory(db, [...new Set([...sold, ...returned].map((r) => r.productId))]);
  const byProduct = new Map<string, ProfitReportRow>();

  const add = (line: (typeof sold)[number], sign: 1 | -1) => {
    const row = byProduct.get(line.productId) ?? {
      productId: line.productId,
      name: line.name,
      uom: line.uom,
      qtySold: 0,
      taxablePaise: 0,
      costPaise: 0,
      profitPaise: 0,
      marginPercent: null,
      hasCost: true,
    };
    const unit = costAt(history.get(line.productId), line.soldAt);
    if (!unit) row.hasCost = false;
    row.qtySold += sign * line.qty;
    row.taxablePaise += sign * line.taxablePaise;
    row.costPaise += sign * Math.round((unit ?? 0) * line.qty);
    byProduct.set(line.productId, row);
  };
  for (const line of sold) add(line, 1);
  for (const line of returned) add(line, -1);

  const rows = [...byProduct.values()]
    .map((r) => {
      const profitPaise = r.taxablePaise - r.costPaise;
      return {
        ...r,
        qtySold: Math.round(r.qtySold * 1000) / 1000,
        profitPaise,
        marginPercent: percent(r.taxablePaise, profitPaise),
      };
    })
    .sort((a, b) => b.profitPaise - a.profitPaise || a.name.localeCompare(b.name));

  const taxablePaise = rows.reduce((sum, r) => sum + r.taxablePaise, 0);
  const costPaise = rows.reduce((sum, r) => sum + r.costPaise, 0);
  const profitPaise = taxablePaise - costPaise;
  return {
    taxablePaise,
    costPaise,
    profitPaise,
    marginPercent: percent(taxablePaise, profitPaise),
    productsWithoutCost: rows.filter((r) => !r.hasCost).length,
    rows,
  };
}

/** Today's completed bills and their payment mix, from `startIso` (the local start of day). */
async function salesSince(db: Db, storeId: string, startIso: string): Promise<SalesSummary & { customersServed: number }> {
  const sales = await db
    .selectFrom("sales")
    .select(["id", "netPaise", "customerId"])
    .where("storeId", "=", storeId)
    .where("status", "=", "completed")
    .where("createdAt", ">=", startIso)
    .execute();

  const payments =
    sales.length === 0
      ? []
      : await db
          .selectFrom("payments")
          .select("mode")
          .select((eb) => eb.fn.sum<number | null>("amountPaise").as("amountPaise"))
          .where(
            "saleId",
            "in",
            sales.map((s) => s.id),
          )
          .groupBy("mode")
          .execute();

  return {
    netPaise: sales.reduce((sum, s) => sum + s.netPaise, 0),
    billCount: sales.length,
    paymentMix: payments.map((p) => ({
      mode: p.mode as SalesSummary["paymentMix"][number]["mode"],
      amountPaise: Number(p.amountPaise ?? 0),
    })),
    customersServed: new Set(sales.map((s) => s.customerId).filter((id): id is string => id !== null)).size,
  };
}

/**
 * Everything the dashboard shows, from the same queries the detailed screens use, so the
 * numbers agree: low stock is inventory's getLowStock, expiry is the batch list, profit is
 * the profit report for today.
 */
export async function getDashboardSummary(
  db: Db,
  storeId: string,
  options: { startIso: string; today: string; alertDays: number; includeProfit: boolean },
): Promise<DashboardSummary> {
  const sales = await salesSince(db, storeId, options.startIso);

  const refunds = await db
    .selectFrom("saleReturns")
    .where("storeId", "=", storeId)
    .where("createdAt", ">=", options.startIso)
    .select((eb) => eb.fn.sum<number | null>("refundPaise").as("total"))
    .executeTakeFirst();

  const profit = options.includeProfit
    ? await getProfitReport(db, storeId, {
        fromIso: options.startIso,
        toIso: new Date(Date.parse(options.startIso) + DAY_MS).toISOString(),
      })
    : null;

  const lowStock = await getLowStock(db, storeId);
  const batches = await listExpiring(db, storeId, options.today, options.alertDays);

  const customers = await db
    .selectFrom("customers")
    .where("storeId", "=", storeId)
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .executeTakeFirst();

  return {
    netPaise: sales.netPaise,
    billCount: sales.billCount,
    paymentMix: sales.paymentMix,
    refundPaise: Number(refunds?.total ?? 0),
    grossProfitPaise: profit ? profit.profitPaise : null,
    productsWithoutCost: profit ? profit.productsWithoutCost : null,
    lowStockCount: lowStock.length,
    expiringCount: batches.filter((b) => b.status === "expiring").length,
    expiredCount: batches.filter((b) => b.status === "expired").length,
    customerCount: Number(customers?.count ?? 0),
    customersServedToday: sales.customersServed,
  };
}

/** Active products with stock and their current cost, the base of both stock-movement reports. */
async function stockedProducts(db: Db, storeId: string) {
  return db
    .selectFrom("inventory as inv")
    .innerJoin("products as p", "p.id", "inv.productId")
    .leftJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null))
    .where("inv.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .where("inv.qtyOnHand", ">", 0)
    .select([
      "p.id as productId",
      "p.name as name",
      "p.uom as uom",
      "p.createdAt as createdAt",
      "inv.qtyOnHand as qtyOnHand",
      "pp.costPricePaise as costPricePaise",
    ])
    .execute();
}

async function qtySoldSince(db: Db, storeId: string, sinceIso: string, untilIso: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", sinceIso)
    .where("s.createdAt", "<", untilIso)
    .groupBy("si.productId")
    .select("si.productId as productId")
    .select((eb) => eb.fn.sum<number | null>("si.qty").as("qty"))
    .execute();
  return new Map(rows.map((r) => [r.productId, Number(r.qty ?? 0)]));
}

/**
 * Products that are selling, but so slowly the stock on hand would last longer than
 * `minCoverDays` at the rate of the last `lookbackDays`. Longest cover first.
 */
export async function getSlowMovingStock(
  db: Db,
  storeId: string,
  options: { asOfIso: string; lookbackDays?: number; minCoverDays?: number },
): Promise<SlowMovingRow[]> {
  const lookbackDays = options.lookbackDays ?? 30;
  const minCoverDays = options.minCoverDays ?? 60;
  const since = new Date(Date.parse(options.asOfIso) - lookbackDays * DAY_MS).toISOString();
  const sold = await qtySoldSince(db, storeId, since, options.asOfIso);

  const rows: SlowMovingRow[] = [];
  for (const p of await stockedProducts(db, storeId)) {
    const qtySold = sold.get(p.productId) ?? 0;
    if (qtySold <= 0) continue;
    const daysOfCover = Math.round((p.qtyOnHand / (qtySold / lookbackDays)) * 10) / 10;
    if (daysOfCover <= minCoverDays) continue;
    rows.push({
      productId: p.productId,
      name: p.name,
      uom: p.uom,
      qtyOnHand: p.qtyOnHand,
      qtySold,
      daysOfCover,
      valuePaise: Math.round((p.costPricePaise ?? 0) * p.qtyOnHand),
    });
  }
  return rows.sort((a, b) => b.daysOfCover - a.daysOfCover || a.name.localeCompare(b.name));
}

/**
 * Products with stock that haven't sold at all in the last `days`, and that have been in the
 * shop longer than that (a product added last week isn't dead, just new). Most money tied up first.
 */
export async function getDeadStock(
  db: Db,
  storeId: string,
  options: { asOfIso: string; days?: number },
): Promise<DeadStockRow[]> {
  const days = options.days ?? 90;
  const since = new Date(Date.parse(options.asOfIso) - days * DAY_MS).toISOString();
  const sold = await qtySoldSince(db, storeId, since, options.asOfIso);

  const candidates = (await stockedProducts(db, storeId)).filter(
    (p) => p.createdAt < since && (sold.get(p.productId) ?? 0) <= 0,
  );
  if (candidates.length === 0) return [];

  const lastSold = await db
    .selectFrom("saleItems as si")
    .innerJoin("sales as s", "s.id", "si.saleId")
    .where("s.storeId", "=", storeId)
    .where("s.status", "=", "completed")
    .where(
      "si.productId",
      "in",
      candidates.map((c) => c.productId),
    )
    .groupBy("si.productId")
    .select("si.productId as productId")
    .select((eb) => eb.fn.max("s.createdAt").as("lastSoldAt"))
    .execute();
  const lastById = new Map(lastSold.map((r) => [r.productId, r.lastSoldAt as string | null]));

  return candidates
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      uom: p.uom,
      qtyOnHand: p.qtyOnHand,
      lastSoldAt: lastById.get(p.productId) ?? null,
      valuePaise: Math.round((p.costPricePaise ?? 0) * p.qtyOnHand),
    }))
    .sort((a, b) => b.valuePaise - a.valuePaise || a.name.localeCompare(b.name));
}

/** Current price list of active products, for the margin report (built in business-logic). */
export async function listCurrentPrices(db: Db, storeId: string): Promise<CurrentPriceRow[]> {
  const rows = await db
    .selectFrom("products as p")
    .innerJoin("productPrices as pp", (join) => join.onRef("pp.productId", "=", "p.id").on("pp.effectiveTo", "is", null))
    .where("p.storeId", "=", storeId)
    .where("p.isActive", "=", 1)
    .select([
      "p.id as productId",
      "p.name as name",
      "p.uom as uom",
      "p.taxRatePercent as taxRatePercent",
      "pp.salePricePaise as salePricePaise",
      "pp.costPricePaise as costPricePaise",
      "pp.isTaxInclusive as isTaxInclusive",
    ])
    .execute();
  return rows.map((r) => ({ ...r, isTaxInclusive: r.isTaxInclusive === 1 }));
}

/** Expired and soon-to-expire batches, for the expiry report. */
export async function getExpiryReport(
  db: Db,
  storeId: string,
  today: string,
  withinDays: number,
): Promise<ExpiringBatchRow[]> {
  return listExpiring(db, storeId, today, withinDays);
}
