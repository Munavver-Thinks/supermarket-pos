import { useEffect, useState } from "react";
import { EXPIRY_ALERT_DAYS, formatIndianCurrency, paiseForCsv } from "@pos/business-logic";
import type { DeadStockRow, ExpiringBatchRow, MarginRow, ProfitReport, SlowMovingRow } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import type { ReportRequest } from "../../../shared/ipc.js";

type CsvRows = Array<Array<string | number | null>>;

interface InsightsReportsProps {
  /** The date range chosen at the top of Reports; only the profit report uses it. */
  req: ReportRequest;
  /** Bumped by Refresh. */
  reloadKey: number;
  exportCsv: (name: string, headers: string[], rows: CsvRows) => Promise<void>;
}

const SLOW_LOOKBACK_DAYS = 30;
const SLOW_MIN_COVER_DAYS = 60;
const DEAD_DAYS = 90;

function isDenied<T>(value: T | { ok: false; error: string }): value is { ok: false; error: string } {
  return typeof value === "object" && value !== null && "ok" in value && (value as { ok: unknown }).ok === false;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/** Profit, margins, slow-moving and dead stock, and expiry — the stock-side reports. */
export function InsightsReports({ req, reloadKey, exportCsv }: InsightsReportsProps): JSX.Element {
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [margins, setMargins] = useState<MarginRow[]>([]);
  const [slow, setSlow] = useState<SlowMovingRow[]>([]);
  const [dead, setDead] = useState<DeadStockRow[]>([]);
  const [expiry, setExpiry] = useState<ExpiringBatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { storeId, actingUserId, fromIso, toIso } = req;

  // Driven by the screen's reload counter alone: Reports bumps it whenever the dates change or
  // Refresh is pressed, so each change loads once.
  useEffect(() => {
    if (reloadKey === 0) return;
    let cancelled = false;
    const actor = { storeId, actingUserId };
    void Promise.all([
      window.api.reports.profit({ storeId, actingUserId, fromIso, toIso }),
      window.api.reports.margins(storeId, actingUserId),
      window.api.reports.slowMoving(actor, { lookbackDays: SLOW_LOOKBACK_DAYS, minCoverDays: SLOW_MIN_COVER_DAYS }),
      window.api.reports.deadStock(actor, { days: DEAD_DAYS }),
      window.api.reports.expiry(storeId, actingUserId, EXPIRY_ALERT_DAYS),
    ])
      .then(([p, m, s, d, e]) => {
        if (cancelled) return;
        if (isDenied(p)) {
          setError(p.error);
          return;
        }
        setError(null);
        setProfit(p);
        if (!isDenied(m)) setMargins(m);
        if (!isDenied(s)) setSlow(s);
        if (!isDenied(d)) setDead(d);
        if (!isDenied(e)) setExpiry(e);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the stock reports.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <BlueprintCard>
        <div className="error-text">{error}</div>
      </BlueprintCard>
    );
  }

  const flaggedMargins = margins.filter((m) => m.belowCost || m.noCost);

  return (
    <div className="reports-grid">
      <BlueprintCard>
        <div className="reports-card-head">
          <h2>Profit · estimate</h2>
          {profit && profit.rows.length > 0 && (
            <button
              className="secondary-btn reports-export"
              onClick={() =>
                void exportCsv(
                  "profit",
                  ["Product", "Unit", "Qty sold", "Taxable", "Cost of goods", "Profit", "Margin %", "Has cost"],
                  profit.rows.map((r) => [
                    r.name,
                    r.uom,
                    r.qtySold,
                    paiseForCsv(r.taxablePaise),
                    paiseForCsv(r.costPaise),
                    paiseForCsv(r.profitPaise),
                    r.marginPercent,
                    r.hasCost ? "yes" : "no",
                  ]),
                )
              }
            >
              Export CSV
            </button>
          )}
        </div>
        <p className="note reports-note">
          Taxable value minus cost of goods, at the cost price recorded when each bill was made. Returns are netted off.
          Items with no cost price count as zero cost and are flagged.
        </p>
        {profit && (
          <>
            <div className="tools-row reports-pills">
              <span className="pill ok">Gross profit {formatIndianCurrency(profit.profitPaise)}</span>
              <span className="pill mute">Cost of goods {formatIndianCurrency(profit.costPaise)}</span>
              <span className="note">margin {pct(profit.marginPercent)}</span>
              <span className={profit.productsWithoutCost ? "note reports-warn-text" : "note"}>
                {profit.productsWithoutCost
                  ? `${profit.productsWithoutCost} product(s) have no cost price`
                  : `on ${formatIndianCurrency(profit.taxablePaise)} taxable`}
              </span>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th className="num">Taxable</th>
                    <th className="num">Cost</th>
                    <th className="num">Profit</th>
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.rows.slice(0, 30).map((r) => (
                    <tr key={r.productId}>
                      <td>
                        {r.name}
                        {!r.hasCost && <span className="pill bad reports-tag-gap">no cost</span>}
                      </td>
                      <td className="num">
                        {r.qtySold} {r.uom}
                      </td>
                      <td className="num">{formatIndianCurrency(r.taxablePaise)}</td>
                      <td className="num">{formatIndianCurrency(r.costPaise)}</td>
                      <td className="num">{formatIndianCurrency(r.profitPaise)}</td>
                      <td className="num">{pct(r.marginPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {profit.rows.length === 0 && <div className="empty-state reports-empty">No sales in this range.</div>}
            {profit.rows.length > 30 && (
              <div className="note reports-foot">Showing the 30 most profitable. Export for the full list.</div>
            )}
          </>
        )}
      </BlueprintCard>

      <BlueprintCard>
        <div className="reports-card-head">
          <h2>Margins · current prices</h2>
          {margins.length > 0 && (
            <button
              className="secondary-btn reports-export"
              onClick={() =>
                void exportCsv(
                  "margins",
                  ["Product", "Unit", "Sale price", "Sale ex-GST", "Cost", "Margin %", "Below cost", "No cost"],
                  margins.map((m) => [
                    m.name,
                    m.uom,
                    paiseForCsv(m.salePricePaise),
                    paiseForCsv(m.salePriceExTaxPaise),
                    paiseForCsv(m.costPricePaise),
                    m.marginPercent,
                    m.belowCost ? "yes" : "no",
                    m.noCost ? "yes" : "no",
                  ]),
                )
              }
            >
              Export CSV
            </button>
          )}
        </div>
        <p className="note reports-note">
          Sale price with GST taken out, against the recorded cost. Not affected by the dates above. Showing products
          selling below cost or with no cost price; export for every product.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Sale (ex-GST)</th>
                <th className="num">Cost</th>
                <th className="num">Margin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flaggedMargins.map((m) => (
                <tr key={m.productId}>
                  <td>{m.name}</td>
                  <td className="num">{formatIndianCurrency(m.salePriceExTaxPaise)}</td>
                  <td className="num">{m.noCost ? "—" : formatIndianCurrency(m.costPricePaise)}</td>
                  <td className="num reports-warn-text">{pct(m.marginPercent)}</td>
                  <td>
                    <span className="pill bad">{m.belowCost ? "Below cost" : "No cost price"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {flaggedMargins.length === 0 && (
          <div className="empty-state reports-empty">Every product sells above its recorded cost.</div>
        )}
      </BlueprintCard>

      <BlueprintCard>
        <div className="reports-card-head">
          <h2>Slow-moving stock</h2>
          {slow.length > 0 && (
            <button
              className="secondary-btn reports-export"
              onClick={() =>
                void exportCsv(
                  "slow_moving",
                  ["Product", "Unit", "On hand", `Sold (${SLOW_LOOKBACK_DAYS} days)`, "Days of cover", "Value at cost"],
                  slow.map((r) => [r.name, r.uom, r.qtyOnHand, r.qtySold, r.daysOfCover, paiseForCsv(r.valuePaise)]),
                )
              }
            >
              Export CSV
            </button>
          )}
        </div>
        <p className="note reports-note">
          Sold in the last {SLOW_LOOKBACK_DAYS} days, but at that rate the stock on hand lasts more than{" "}
          {SLOW_MIN_COVER_DAYS} days.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th className="num">Sold ({SLOW_LOOKBACK_DAYS}d)</th>
                <th className="num">Days of cover</th>
                <th className="num">Value at cost</th>
              </tr>
            </thead>
            <tbody>
              {slow.map((r) => (
                <tr key={r.productId}>
                  <td>{r.name}</td>
                  <td className="num">
                    {r.qtyOnHand} {r.uom}
                  </td>
                  <td className="num">{r.qtySold}</td>
                  <td className="num">{r.daysOfCover}</td>
                  <td className="num">{formatIndianCurrency(r.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {slow.length === 0 && <div className="empty-state reports-empty">Nothing slow-moving.</div>}
      </BlueprintCard>

      <BlueprintCard>
        <div className="reports-card-head">
          <h2>Dead stock</h2>
          {dead.length > 0 && (
            <button
              className="secondary-btn reports-export"
              onClick={() =>
                void exportCsv(
                  "dead_stock",
                  ["Product", "Unit", "On hand", "Last sold", "Value at cost"],
                  dead.map((r) => [r.name, r.uom, r.qtyOnHand, r.lastSoldAt, paiseForCsv(r.valuePaise)]),
                )
              }
            >
              Export CSV
            </button>
          )}
        </div>
        <p className="note reports-note">In stock, in the shop for over {DEAD_DAYS} days, and not sold once in that time.</p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">On hand</th>
                <th>Last sold</th>
                <th className="num">Value at cost</th>
              </tr>
            </thead>
            <tbody>
              {dead.map((r) => (
                <tr key={r.productId}>
                  <td>{r.name}</td>
                  <td className="num">
                    {r.qtyOnHand} {r.uom}
                  </td>
                  <td>{r.lastSoldAt ? new Date(r.lastSoldAt).toLocaleDateString("en-IN") : "Never"}</td>
                  <td className="num">{formatIndianCurrency(r.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dead.length === 0 && <div className="empty-state reports-empty">No dead stock.</div>}
      </BlueprintCard>

      <BlueprintCard className="reports-wide">
        <div className="reports-card-head">
          <h2>Expired and expiring stock</h2>
          {expiry.length > 0 && (
            <button
              className="secondary-btn reports-export"
              onClick={() =>
                void exportCsv(
                  "expiry",
                  ["Product", "Unit", "Batch", "Expiry date", "Status", "Qty left", "Value at cost"],
                  expiry.map((r) => [
                    r.productName,
                    r.uom,
                    r.batchNo,
                    r.expiryDate,
                    r.status,
                    r.qtyRemaining,
                    paiseForCsv(r.valuePaise),
                  ]),
                )
              }
            >
              Export CSV
            </button>
          )}
        </div>
        <p className="note reports-note">
          Batches with stock left that are past their date or expire within {EXPIRY_ALERT_DAYS} days. Only stock
          received with an expiry date appears here.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="num">Left</th>
                <th className="num">Value at cost</th>
              </tr>
            </thead>
            <tbody>
              {expiry.map((r) => (
                <tr key={r.batchId}>
                  <td>{r.productName}</td>
                  <td>{r.batchNo ?? "—"}</td>
                  <td>
                    <span className={"pill " + (r.status === "expired" ? "bad" : "warn")}>
                      {r.status === "expired" ? "Expired" : "Expiring"} {r.expiryDate}
                    </span>
                  </td>
                  <td className="num">
                    {r.qtyRemaining} {r.uom}
                  </td>
                  <td className="num">{formatIndianCurrency(r.valuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {expiry.length === 0 && <div className="empty-state reports-empty">Nothing expired or expiring soon.</div>}
      </BlueprintCard>
    </div>
  );
}
