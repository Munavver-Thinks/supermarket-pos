import { useCallback, useEffect, useState } from "react";
import { formatIndianCurrency, paiseForCsv, toCsv } from "@pos/business-logic";
import type { GstRateRow, HsnSummaryRow, SalesReport, StockValuationRow, TopProductRow } from "@pos/types";

import { isDenied } from "@/services/ipcResult.js";
import { endOfLocalDay, isoDate, startOfLocalDay } from "@/utils/date.js";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { InsightsReports } from "./InsightsReports.js";
import { reportsService } from "./services/reportsService.js";

export function ReportsScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const today = isoDate(new Date());
  const monthStart = today.slice(0, 8) + "01";

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [gst, setGst] = useState<GstRateRow[]>([]);
  const [hsn, setHsn] = useState<HsnSummaryRow[]>([]);
  const [top, setTop] = useState<TopProductRow[]>([]);
  const [stock, setStock] = useState<StockValuationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!context || !user) return;
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);

    const req = {
      storeId: context.storeId,
      actingUserId: user.id,
      fromIso: startOfLocalDay(from),
      toIso: endOfLocalDay(to),
    };

    const [salesResult, gstResult, hsnResult, topResult, stockResult] = await Promise.all([
      reportsService.sales(req),
      reportsService.gst(req),
      reportsService.hsn(req),
      reportsService.topProducts(req, 15),
      reportsService.stockValuation(context.storeId, user.id),
    ]);

    setLoading(false);

    if (isDenied(salesResult)) {
      setError(salesResult.error);
      return;
    }
    setSales(salesResult);
    if (!isDenied(gstResult)) setGst(gstResult);
    if (!isDenied(hsnResult)) setHsn(hsnResult);
    if (!isDenied(topResult)) setTop(topResult);
    if (!isDenied(stockResult)) setStock(stockResult);
  }, [context, user, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv(name: string, headers: string[], rows: Array<Array<string | number | null>>): Promise<void> {
    const result = await reportsService.exportCsv(`${name}_${from}_to_${to}.csv`, toCsv(headers, rows));
    setExportMessage(result.ok ? `Saved to ${result.path}` : (result.error ?? "Could not save the file."));
  }

  const stockValuePaise = stock.reduce((sum, s) => sum + s.valuePaise, 0);

  if (error) {
    return (
      <div className="screen-section">
        <BlueprintCard>
          <h2>Reports</h2>
          <div className="error-text">{error}</div>
        </BlueprintCard>
      </div>
    );
  }

  return (
    <div className="screen-section">
      <div>
        <div className="tools-row reports-tools">
          <div className="field reports-date">
            <label htmlFor="report-from">From</label>
            <input id="report-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field reports-date">
            <label htmlFor="report-to">To</label>
            <input id="report-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="secondary-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <div className="note reports-tools-note">Both dates included. Returns are netted off every figure below.</div>
        </div>
        {exportMessage && <div className="note reports-message">{exportMessage}</div>}
      </div>

      {sales && (
        <>
          <div className="kpi-grid reports-kpis">
            <div className="blueprint kpi-card">
              <div className="card-kicker">Net takings</div>
              <div className="kpi-value">{formatIndianCurrency(sales.netPaise)}</div>
              <div className="kpi-delta">
                {sales.billCount} bills
                {sales.returnCount > 0 && ` · ${sales.returnCount} returned`}
              </div>
            </div>
            <div className="blueprint kpi-card">
              <div className="card-kicker">GST collected</div>
              <div className="kpi-value">{formatIndianCurrency(sales.cgstPaise + sales.sgstPaise)}</div>
              <div className="kpi-delta">on {formatIndianCurrency(sales.taxablePaise)} taxable</div>
            </div>
            <div className="blueprint kpi-card">
              <div className="card-kicker">Gross</div>
              <div className="kpi-value">{formatIndianCurrency(sales.grossPaise)}</div>
            </div>
            <div className="blueprint kpi-card">
              <div className="card-kicker">Discount given</div>
              <div className="kpi-value">-{formatIndianCurrency(sales.discountPaise)}</div>
            </div>
            <div className="blueprint kpi-card">
              <div className="card-kicker">Refunded on returns</div>
              <div className="kpi-value">-{formatIndianCurrency(sales.refundPaise)}</div>
            </div>
          </div>

          <BlueprintCard>
            <div className="reports-card-head">
              <h2>Sales</h2>
              <button
                className="secondary-btn reports-export"
                onClick={() =>
                  void exportCsv(
                    "sales_summary",
                    ["Measure", "Amount"],
                    [
                      ["Bills", sales.billCount],
                      ["Returns", sales.returnCount],
                      ["Gross", paiseForCsv(sales.grossPaise)],
                      ["Discount", paiseForCsv(sales.discountPaise)],
                      ["Taxable", paiseForCsv(sales.taxablePaise)],
                      ["CGST", paiseForCsv(sales.cgstPaise)],
                      ["SGST", paiseForCsv(sales.sgstPaise)],
                      ["Refunds", paiseForCsv(sales.refundPaise)],
                      ["Net", paiseForCsv(sales.netPaise)],
                      ...sales.paymentMix.map((p) => [`Taken as ${p.mode}`, paiseForCsv(p.amountPaise)]),
                    ],
                  )
                }
              >
                Export CSV
              </button>
            </div>
            <table className="table">
              <tbody>
                {sales.paymentMix.map((p) => (
                  <tr key={p.mode}>
                    <td className="text-muted">Taken as {p.mode.toUpperCase()}</td>
                    <td className="text-muted num">{formatIndianCurrency(p.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </BlueprintCard>
        </>
      )}

      <div className="reports-grid">
        <BlueprintCard>
          <div className="reports-card-head">
            <h2>GST · rate-wise</h2>
            {gst.length > 0 && (
              <button
                className="secondary-btn reports-export"
                onClick={() =>
                  void exportCsv(
                    "gstr1_rate_wise",
                    ["Rate %", "Taxable value", "CGST", "SGST", "Total tax"],
                    gst.map((r) => [
                      r.taxRatePercent,
                      paiseForCsv(r.taxablePaise),
                      paiseForCsv(r.cgstPaise),
                      paiseForCsv(r.sgstPaise),
                      paiseForCsv(r.totalTaxPaise),
                    ]),
                  )
                }
              >
                Export CSV
              </button>
            )}
          </div>
          <p className="note reports-note">
            The table a GSTR-1 return is filled in from. Returns are subtracted at the rate they were sold at.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Rate</th>
                  <th className="num">Taxable value</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                  <th className="num">Total tax</th>
                </tr>
              </thead>
              <tbody>
                {gst.map((row) => (
                  <tr key={row.taxRatePercent}>
                    <td>{row.taxRatePercent}%</td>
                    <td className="num">{formatIndianCurrency(row.taxablePaise)}</td>
                    <td className="num">{formatIndianCurrency(row.cgstPaise)}</td>
                    <td className="num">{formatIndianCurrency(row.sgstPaise)}</td>
                    <td className="num">
                      <strong>{formatIndianCurrency(row.totalTaxPaise)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gst.length === 0 && <div className="empty-state reports-empty">No sales in this range.</div>}
        </BlueprintCard>

        <BlueprintCard>
          <div className="reports-card-head">
            <h2>GST · HSN summary</h2>
            {hsn.length > 0 && (
              <button
                className="secondary-btn reports-export"
                onClick={() =>
                  void exportCsv(
                    "gstr1_hsn",
                    ["HSN", "Rate %", "Qty", "Taxable value", "CGST", "SGST"],
                    hsn.map((r) => [
                      r.hsnCode,
                      r.taxRatePercent,
                      r.qty,
                      paiseForCsv(r.taxablePaise),
                      paiseForCsv(r.cgstPaise),
                      paiseForCsv(r.sgstPaise),
                    ]),
                  )
                }
              >
                Export CSV
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>HSN</th>
                  <th>Rate</th>
                  <th className="num">Qty</th>
                  <th className="num">Taxable value</th>
                  <th className="num">Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsn.map((row, i) => (
                  <tr key={`${row.hsnCode ?? "none"}-${row.taxRatePercent}-${i}`}>
                    <td className="reports-mono">{row.hsnCode ?? <span className="text-muted">not set</span>}</td>
                    <td>{row.taxRatePercent}%</td>
                    <td className="num">{row.qty}</td>
                    <td className="num">{formatIndianCurrency(row.taxablePaise)}</td>
                    <td className="num">{formatIndianCurrency(row.cgstPaise + row.sgstPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hsn.some((r) => r.hsnCode === null) && (
            <div className="note reports-foot">
              Rows marked “not set” have no HSN code on the product. Add one in Inventory before filing.
            </div>
          )}
        </BlueprintCard>

        <BlueprintCard>
          <div className="reports-card-head">
            <h2>Top products</h2>
            {top.length > 0 && (
              <button
                className="secondary-btn reports-export"
                onClick={() =>
                  void exportCsv(
                    "top_products",
                    ["Product", "Unit", "Qty sold", "Revenue"],
                    top.map((r) => [r.name, r.uom, r.qty, paiseForCsv(r.revenuePaise)]),
                  )
                }
              >
                Export CSV
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty sold</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {top.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.name}</td>
                    <td className="num">
                      {row.qty} {row.uom}
                    </td>
                    <td className="num">{formatIndianCurrency(row.revenuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BlueprintCard>

        <BlueprintCard>
          <div className="reports-card-head">
            <h2>Stock on hand</h2>
            {stock.length > 0 && (
              <button
                className="secondary-btn reports-export"
                onClick={() =>
                  void exportCsv(
                    "stock_valuation",
                    ["Product", "Unit", "On hand", "Cost price", "Sale price", "Value at cost"],
                    stock.map((r) => [
                      r.name,
                      r.uom,
                      r.qtyOnHand,
                      paiseForCsv(r.costPricePaise),
                      paiseForCsv(r.salePricePaise),
                      paiseForCsv(r.valuePaise),
                    ]),
                  )
                }
              >
                Export CSV
              </button>
            )}
          </div>
          <div className="card-kicker reports-kicker">
            Valued at cost · {formatIndianCurrency(stockValuePaise)} across {stock.length} products
          </div>
          <p className="note reports-note">A snapshot of right now — not affected by the dates above.</p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">On hand</th>
                  <th className="num">Cost</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {stock.slice(0, 20).map((row) => (
                  <tr key={row.productId}>
                    <td>{row.name}</td>
                    <td className="num">
                      {row.qtyOnHand} {row.uom}
                    </td>
                    <td className="num">{formatIndianCurrency(row.costPricePaise)}</td>
                    <td className="num">{formatIndianCurrency(row.valuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stock.length > 20 && <div className="note reports-foot">Showing the 20 most valuable. Export for the full list.</div>}
        </BlueprintCard>
      </div>

      {context && user && (
        <InsightsReports
          req={{ storeId: context.storeId, actingUserId: user.id, fromIso: startOfLocalDay(from), toIso: endOfLocalDay(to) }}
          reloadKey={reloadKey}
          exportCsv={exportCsv}
        />
      )}
    </div>
  );
}
