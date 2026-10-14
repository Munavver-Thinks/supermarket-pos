import { useEffect, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { DashboardSummary } from "@pos/types";

import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";

import { useAlertsStore } from "../../store/alertsStore.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { CashRegisterCard } from "./CashRegisterCard.js";
import { dashboardService } from "./services/dashboardService.js";

const PAYMENT_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Credit",
};

/** Bar length only: a method's share of today's takings, clamped to 0-100. */
function sharePercent(amountPaise: number, totalPaise: number): number {
  if (totalPaise <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((amountPaise / totalPaise) * 100)));
}

interface DashboardScreenProps {
  onGoBilling: () => void;
  onGoInventory: () => void;
}

export function DashboardScreen({ onGoBilling, onGoInventory }: DashboardScreenProps): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const refreshAlerts = useAlertsStore((s) => s.refresh);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context || !user) return;
    dashboardService
      .getSummary(context.storeId, user.id)
      .then((result) => {
        if ("ok" in result) {
          setError(result.error);
          return;
        }
        setSummary(result);
      })
      .catch(() => setError("Could not load today's figures."));
    void refreshAlerts(context.storeId);
  }, [context, user, refreshAlerts]);

  // Profit is only in the response for owners and managers; for everyone else it is null
  // and the card isn't shown at all.
  const showProfit = summary !== null && summary.grossProfitPaise !== null;
  const expiryTotal = summary ? summary.expiringCount + summary.expiredCount : null;
  const mixTotal = summary ? summary.paymentMix.reduce((sum, p) => sum + p.amountPaise, 0) : 0;

  return (
    <div className="screen-section">
      {error && <div className="error-text">{error}</div>}
      <div className="kpi-grid">
        <button className="blueprint kpi-card dash-kpi dash-kpi-btn" onClick={onGoBilling}>
          <div className="card-kicker">Today&rsquo;s sales</div>
          <div className="kpi-value">{summary ? formatIndianCurrency(summary.netPaise) : "—"}</div>
          <div className="kpi-delta">
            {summary
              ? `${summary.billCount} bills` +
                (summary.refundPaise > 0 ? ` · ${formatIndianCurrency(summary.refundPaise)} refunded` : "")
              : "Loading…"}
          </div>
        </button>

        {showProfit && summary && (
          <div className="blueprint kpi-card dash-kpi">
            <div className="card-kicker">Gross profit today &middot; estimate</div>
            <div className="kpi-value">{formatIndianCurrency(summary.grossProfitPaise ?? 0)}</div>
            <div className={"kpi-delta" + (summary.productsWithoutCost ? " warn" : "")}>
              {summary.productsWithoutCost
                ? `${summary.productsWithoutCost} item${summary.productsWithoutCost === 1 ? " has" : "s have"} no cost price`
                : "at recorded cost, returns netted"}
            </div>
          </div>
        )}

        <button className="blueprint kpi-card dash-kpi dash-kpi-btn" onClick={onGoInventory}>
          <div className="card-kicker">Low stock</div>
          <div className="kpi-value">{summary ? summary.lowStockCount : "—"}</div>
          <div className={"kpi-delta" + (summary?.lowStockCount ? " warn" : "")}>
            {summary === null
              ? "Loading…"
              : summary.lowStockCount > 0
                ? "out of stock or at reorder level"
                : "All healthy"}
          </div>
        </button>

        <button className="blueprint kpi-card dash-kpi dash-kpi-btn" onClick={onGoInventory}>
          <div className="card-kicker">Expiry</div>
          <div className="kpi-value">{expiryTotal ?? "—"}</div>
          <div className={"kpi-delta" + (summary?.expiredCount ? " warn" : "")}>
            {summary === null
              ? "Loading…"
              : expiryTotal
                ? `${summary.expiredCount} expired · ${summary.expiringCount} expiring in 30 days`
                : "No dated stock expiring soon"}
          </div>
        </button>

        <div className="blueprint kpi-card dash-kpi">
          <div className="card-kicker">Customers</div>
          <div className="kpi-value">{summary ? summary.customerCount : "—"}</div>
          <div className="kpi-delta">
            {summary ? `${summary.customersServedToday} named on today's bills` : "Loading…"}
          </div>
        </div>
      </div>

      <div className="dash-lower">
        <BlueprintCard className="dash-mix">
          <h2>Payment mix &middot; today</h2>
          {summary && summary.paymentMix.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="r">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.paymentMix.map((p) => (
                  <tr key={p.mode}>
                    <td>{PAYMENT_MODE_LABEL[p.mode] ?? p.mode}</td>
                    <td className="r">{formatIndianCurrency(p.amountPaise)}</td>
                    <td>
                      <div className="dash-bar">
                        <i className={"dash-bar-" + p.mode} style={{ width: `${sharePercent(p.amountPaise, mixTotal)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="note">{summary ? "No completed sales yet today." : "Loading…"}</p>
          )}
        </BlueprintCard>

        <div className="dash-register">
          <CashRegisterCard />
        </div>
      </div>
    </div>
  );
}
