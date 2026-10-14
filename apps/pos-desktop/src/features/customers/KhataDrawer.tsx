import { useCallback, useEffect, useRef, useState } from "react";
import { canChangeStoreSettings, formatIndianCurrency } from "@pos/business-logic";
import type { CustomerLedgerEntry } from "@pos/types";

import { creditService } from "@/services/creditService.js";
import { parseRupeesOrZero } from "@/utils/money.js";

import { useSessionStore } from "../../store/sessionStore.js";
import { useModalKeyboard } from "../../components/useModalKeyboard.js";

/** Everything the drawer needs — deliberately not a full Customer, so a row from the
 *  outstanding list can open it without first being found in the customer list. */
export interface KhataTarget {
  id: string;
  name: string;
  phone: string | null;
  creditLimitPaise: number;
}

interface KhataDrawerProps {
  customer: KhataTarget;
  onClose: () => void;
  onChanged: () => void;
}

const REPAYMENT_MODES = ["cash", "upi", "card"] as const;

const ENTRY_LABEL: Record<string, string> = {
  credit_sale: "Bill on credit",
  repayment: "Payment received",
  return_refund: "Refund to khata",
  opening_balance: "Opening balance",
  write_off: "Written off",
  change_to_khata: "Change kept on khata",
};

export function KhataDrawer({ customer, onClose, onChanged }: KhataDrawerProps): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const canSetLimit = user ? canChangeStoreSettings(user.role) : false;

  const [entries, setEntries] = useState<CustomerLedgerEntry[]>([]);
  const [balancePaise, setBalancePaise] = useState(0);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof REPAYMENT_MODES)[number]>("cash");
  const [note, setNote] = useState("");
  const [limitRupees, setLimitRupees] = useState(
    customer.creditLimitPaise > 0 ? String(customer.creditLimitPaise / 100) : "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  const refresh = useCallback(() => {
    creditService.getBalance(customer.id).then(setBalancePaise).catch(() => undefined);
    creditService.listEntries(customer.id, 50).then(setEntries).catch(() => undefined);
  }, [customer.id]);

  useEffect(refresh, [refresh]);

  async function handleRepayment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !user) return;

    const amountPaise = parseRupeesOrZero(amount);
    if (amountPaise <= 0) {
      setMessage("Enter the amount received.");
      return;
    }

    setBusy(true);
    setMessage(null);
    const result = await creditService.recordRepayment({
      storeId: context.storeId,
      customerId: customer.id,
      userId: user.id,
      amountPaise,
      paymentMode: mode,
      note: note.trim() === "" ? null : note.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.error ?? "Could not record the payment.");
      return;
    }
    setAmount("");
    setNote("");
    setMessage(`Recorded ${formatIndianCurrency(amountPaise)}.`);
    refresh();
    onChanged();
  }

  async function handleSaveLimit(): Promise<void> {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    const result = await creditService.setLimit(
      customer.id,
      parseRupeesOrZero(limitRupees),
      user.id,
    );
    setBusy(false);
    setMessage(result.ok ? "Credit limit saved." : (result.error ?? "Could not save the limit."));
    if (result.ok) onChanged();
  }

  return (
    <div className="modal-backdrop drawer-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card khata-card"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="khata-title"
        ref={cardRef}
      >
        <h2 id="khata-title">{customer.name}</h2>
        <div className="text-muted khata-phone">{customer.phone ?? "No phone on file"}</div>

        <div className={balancePaise > 0 ? "khata-balance owes" : "khata-balance"}>
          <div className="khata-balance-label">
            {balancePaise > 0 ? "Owes" : balancePaise < 0 ? "In credit" : "Settled"}
          </div>
          <div className="khata-balance-amount">{formatIndianCurrency(Math.abs(balancePaise))}</div>
        </div>

        <form onSubmit={handleRepayment} className="khata-pay">
          <h3>Record a payment</h3>
          <div className="field">
            <label htmlFor="khata-amount">Amount (₹)</label>
            <input
              id="khata-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="khata-mode">Received as</label>
            <select
              id="khata-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as (typeof REPAYMENT_MODES)[number])}
            >
              {REPAYMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="field khata-pay-wide">
            <label htmlFor="khata-note">Note (optional)</label>
            <input id="khata-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </div>
          <button className="primary-btn khata-pay-submit" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Record"}
          </button>
        </form>

        <div className="khata-limit">
          <div className="field">
            <label htmlFor="khata-limit">Credit limit (₹)</label>
            <input
              id="khata-limit"
              type="number"
              min={0}
              step="0.01"
              placeholder="no limit"
              disabled={!canSetLimit}
              value={limitRupees}
              onChange={(e) => setLimitRupees(e.target.value)}
            />
          </div>
          <button className="secondary-btn" onClick={handleSaveLimit} disabled={busy || !canSetLimit}>
            Save limit
          </button>
          <div className="text-muted khata-limit-hint">
            {canSetLimit ? "Leave blank for no limit." : "Only an owner or manager can change this."}
          </div>
        </div>

        {message && <div className="khata-message">{message}</div>}

        <h3 className="khata-kicker">History</h3>
        <div className="khata-history">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-muted">{new Date(entry.createdAt).toLocaleDateString("en-IN")}</td>
                  <td>
                    {ENTRY_LABEL[entry.entryType] ?? entry.entryType}
                    {entry.billNo && <span className="text-muted"> · {entry.billNo}</span>}
                    {entry.paymentMode && <span className="text-muted"> · {entry.paymentMode.toUpperCase()}</span>}
                    {entry.note && <div className="text-muted">{entry.note}</div>}
                  </td>
                  <td className={entry.amountPaise < 0 ? "num khata-paid" : "num"}>
                    {entry.amountPaise > 0 ? "+" : ""}
                    {formatIndianCurrency(entry.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <div className="text-muted khata-empty">Nothing on this khata yet.</div>}
        </div>

        {/* Last in the DOM so the amount box keeps the initial focus; CSS lifts it to the header. */}
        <button className="btn btn-ghost khata-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
