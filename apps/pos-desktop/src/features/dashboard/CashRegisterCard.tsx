import { useCallback, useEffect, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { CashSessionSummary } from "@shared/ipc.js";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { cashSessionService } from "./services/cashSessionService.js";

/** Notes and coins in circulation, largest first — the order a drawer is counted in. */
const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

type Counts = Record<number, string>;

const EMPTY_COUNTS: Counts = Object.fromEntries(DENOMINATIONS.map((d) => [d, ""]));

function countedPaise(counts: Counts): number {
  return DENOMINATIONS.reduce((sum, note) => sum + note * 100 * (Number(counts[note]) || 0), 0);
}

export function CashRegisterCard(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const [summary, setSummary] = useState<CashSessionSummary | null>(null);
  const [openingRupees, setOpeningRupees] = useState("");
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!context) return;
    cashSessionService
      .summary(context.counterId)
      .then(setSummary)
      .catch(() => undefined);
  }, [context]);

  useEffect(refresh, [refresh]);

  async function handleOpen(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !user) return;
    setBusy(true);
    setMessage(null);

    const result = await cashSessionService.open({
      storeId: context.storeId,
      counterId: context.counterId,
      userId: user.id,
      openingCashPaise: Math.round((Number(openingRupees) || 0) * 100),
    });

    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not open the register.");
      return;
    }
    setOpeningRupees("");
    setMessage("Register open — ready to bill.");
    refresh();
  }

  async function handleClose(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!summary?.session || !user) return;
    setBusy(true);
    setMessage(null);

    const counted = countedPaise(counts);
    const result = await cashSessionService.close({
      id: summary.session.id,
      userId: user.id,
      closingCashPaise: summary.expectedPaise,
      countedCashPaise: counted,
    });

    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not close the register.");
      return;
    }

    const variance = counted - summary.expectedPaise;
    setMessage(
      variance === 0
        ? "Register closed — drawer matched exactly."
        : `Register closed — drawer ${variance > 0 ? "over" : "short"} by ${formatIndianCurrency(Math.abs(variance))}.`,
    );
    setCounts(EMPTY_COUNTS);
    refresh();
  }

  if (!summary) {
    return (
      <BlueprintCard>
        <h2>Cash register</h2>
        <p className="note">Loading…</p>
      </BlueprintCard>
    );
  }

  if (!summary.session) {
    return (
      <BlueprintCard>
        <h2>Cash register</h2>
        <p className="note">
          Closed. Count the float you are starting the day with and open the register before billing.
        </p>
        <form onSubmit={handleOpen} className="dash-open-form">
          <div className="field">
            <label htmlFor="opening-float">Opening float (₹)</label>
            <input
              id="opening-float"
              required
              type="number"
              min={0}
              step="0.01"
              value={openingRupees}
              onChange={(e) => setOpeningRupees(e.target.value)}
            />
          </div>
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? "Opening…" : "Open Register"}
          </button>
        </form>
        {message && <div className="dash-message">{message}</div>}
      </BlueprintCard>
    );
  }

  const counted = countedPaise(counts);
  const variance = counted - summary.expectedPaise;
  const anyCounted = DENOMINATIONS.some((note) => Number(counts[note]) > 0);

  return (
    <BlueprintCard>
      <h2>Cash register</h2>
      <span className="pill ok">● Register open — ready to bill</span>
      <table className="dash-reg-table">
        <tbody>
          <tr>
            <td>Opened</td>
            <td>{new Date(summary.session.openedAt).toLocaleString("en-IN")}</td>
          </tr>
          <tr>
            <td>Opening float</td>
            <td>{formatIndianCurrency(summary.session.openingCashPaise)}</td>
          </tr>
          <tr>
            <td>Cash taken</td>
            <td>{formatIndianCurrency(summary.cashTakenPaise)}</td>
          </tr>
          <tr className="dash-reg-total">
            <td>Expected in drawer</td>
            <td>{formatIndianCurrency(summary.expectedPaise)}</td>
          </tr>
        </tbody>
      </table>

      <form onSubmit={handleClose}>
        <h3 className="dash-count-title">Count the drawer</h3>
        <div className="dash-denoms">
          {DENOMINATIONS.map((note) => (
            <div className="field" key={note}>
              <label htmlFor={`denom-${note}`}>₹{note}</label>
              <input
                id={`denom-${note}`}
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={counts[note] ?? ""}
                onChange={(e) => setCounts((prev) => ({ ...prev, [note]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="dash-counted">
          <div className="dash-row">
            <span>Counted</span>
            <span className="dash-counted-value">{formatIndianCurrency(counted)}</span>
          </div>
          <div className="dash-row">
            <span>Variance</span>
            <span className={variance === 0 ? undefined : "dash-variance-off"}>
              {variance > 0 ? "+" : ""}
              {formatIndianCurrency(variance)}
            </span>
          </div>
        </div>

        <button className="btn danger-btn dash-close-btn" type="submit" disabled={busy || !anyCounted}>
          {busy ? "Closing…" : "Close Register"}
        </button>
        {!anyCounted && <div className="note dash-hint">Enter the note counts before closing.</div>}
      </form>

      {message && <div className="dash-message">{message}</div>}
    </BlueprintCard>
  );
}
