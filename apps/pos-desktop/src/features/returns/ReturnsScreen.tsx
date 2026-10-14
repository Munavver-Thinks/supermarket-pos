import { useCallback, useEffect, useRef, useState } from "react";
import { canApprove, formatIndianCurrency } from "@pos/business-logic";
import type { ApproverCredentials, RecentReturn, ReturnableSale } from "@pos/types";

import { returnsService } from "@/services/returnsService.js";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { PAYOUT_MODES, previewReturn, REFUND_LABEL, ReturnLinePicker, type PayoutMode } from "./ReturnLinePicker.js";

export function ReturnsScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const [billNo, setBillNo] = useState("");
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [refundMode, setRefundMode] = useState<PayoutMode>("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentReturn[]>([]);
  // One id per refund attempt, kept across the approval round-trip so the resend is the same
  // request (the server answers a repeat with the credit note it already wrote).
  const clientTxnIdRef = useRef<string>(crypto.randomUUID());
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const refreshRecent = useCallback(() => {
    if (!context) return;
    returnsService.listRecent(context.storeId, 20).then(setRecent).catch(() => undefined);
  }, [context]);

  useEffect(refreshRecent, [refreshRecent]);

  async function handleLookup(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context) return;
    setLookupError(null);
    setMessage(null);
    setSale(null);
    setQtys({});
    clientTxnIdRef.current = crypto.randomUUID();

    const found = await returnsService.lookup(context.storeId, billNo.trim());
    if (!found) {
      setLookupError("No completed bill with that number.");
      return;
    }
    if (found.lines.every((l) => l.returnableQty <= 0)) {
      setSale(found);
      setLookupError("Everything on this bill has already been returned.");
      return;
    }
    setSale(found);
    // A bill paid on credit defaults to refunding the khata, which is almost always what
    // is meant — no cash left the drawer for it in the first place.
    setRefundMode(found.hadCreditPayment ? "credit" : "cash");
  }

  // Same engine the main process uses, so the refund shown here is the refund that happens.
  const { selected, refundPaise, previewError } = sale
    ? previewReturn(sale, qtys)
    : { selected: [], refundPaise: 0, previewError: null };

  const khataUnavailable = refundMode === "credit" && !sale?.customerId;

  // Counter staff can't sign off their own refunds. Asking up front saves a round trip; the
  // main process decides regardless and answers approvalRequired if this guess is wrong.
  const needsApproval = user ? !canApprove(user.role, "sale_return") : true;

  function handleRefundClick(): void {
    setMessage(null);
    if (needsApproval) {
      setApprovalError(null);
      setApprovalOpen(true);
      return;
    }
    void handleSubmit(null);
  }

  async function handleSubmit(approver: ApproverCredentials | null): Promise<void> {
    if (!context || !user || !sale) return;
    setBusy(true);
    setMessage(null);

    const result = await returnsService.create({
      storeId: context.storeId,
      counterId: context.counterId,
      saleId: sale.saleId,
      userId: user.id,
      clientTxnId: clientTxnIdRef.current,
      reason: reason.trim() === "" ? null : reason.trim(),
      refundMode,
      lines: selected.map(({ line, qty }) => ({ saleItemId: line.saleItemId, qty })),
      approver,
    });

    setBusy(false);
    if (!result.ok) {
      if (result.approvalRequired) {
        // Shown inside the dialog: either the first ask, or the manager details were refused.
        setApprovalError(approver ? (result.error ?? null) : null);
        setApprovalOpen(true);
        return;
      }
      setApprovalOpen(false);
      setMessage(result.error ?? "Could not record the return.");
      return;
    }
    setApprovalOpen(false);
    clientTxnIdRef.current = crypto.randomUUID();

    setMessage(
      `Credit note ${result.returnNo} — ${formatIndianCurrency(refundPaise)} refunded ${
        refundMode === "credit" ? "to khata" : `in ${REFUND_LABEL[refundMode].toLowerCase()}`
      }.`,
    );
    setSale(null);
    setBillNo("");
    setQtys({});
    setReason("");
    refreshRecent();
  }

  return (
    <div className="screen-section">
      <div className="ret-layout">
      <div className="ret-main">
      <BlueprintCard>
        <h2>Return against a bill</h2>
        <p className="note">The original bill is never changed. A return is its own credit note, linked to it.</p>
        <form onSubmit={handleLookup} className="ret-lookup">
          <div className="field">
            <label htmlFor="return-bill-no">Bill number</label>
            <input
              id="return-bill-no"
              value={billNo}
              placeholder="POS-20261005-12"
              onChange={(e) => setBillNo(e.target.value)}
            />
          </div>
          <button className="secondary-btn" type="submit" disabled={billNo.trim() === ""}>
            Find bill
          </button>
        </form>
        {lookupError && <div className="error-text">{lookupError}</div>}
        {message && <div className="ret-message">{message}</div>}
      </BlueprintCard>

      {sale && (
        <BlueprintCard>
          <div className="card-kicker">
            {sale.billNo} · {new Date(sale.createdAt).toLocaleString("en-IN")} ·{" "}
            {sale.customerName ?? "Walk-in"} · billed {formatIndianCurrency(sale.netPaise)}
          </div>

          <ReturnLinePicker
            sale={sale}
            qtys={qtys}
            onQtyChange={(saleItemId, value) => setQtys((prev) => ({ ...prev, [saleItemId]: value }))}
          />

          <div className="ret-options">
            <div className="field">
              <label htmlFor="refund-mode">Refund as</label>
              <select
                id="refund-mode"
                value={refundMode}
                onChange={(e) => setRefundMode(e.target.value as PayoutMode)}
              >
                {PAYOUT_MODES.map((m) => (
                  <option key={m} value={m} disabled={m === "credit" && !sale.customerId}>
                    {REFUND_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="return-reason">Reason (optional)</label>
              <input
                id="return-reason"
                value={reason}
                maxLength={200}
                placeholder="Damaged, wrong item, changed mind…"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          {khataUnavailable && (
            <div className="error-text">This bill has no customer, so there is no khata to refund to.</div>
          )}
          {previewError && <div className="error-text">{previewError}</div>}

          <div className="ret-refund">
            <span>Refund</span> <span>{formatIndianCurrency(refundPaise)}</span>
          </div>

          <button
            className="primary-btn ret-submit"
            disabled={busy || selected.length === 0 || previewError !== null || khataUnavailable}
            onClick={handleRefundClick}
          >
            {busy ? "Recording…" : `Refund ${formatIndianCurrency(refundPaise)}`}
          </button>
        </BlueprintCard>
      )}
      </div>

      <BlueprintCard className="ret-recent-card">
        <h2>Recent returns</h2>
        <div className="table-scroll">
        <table className="table ret-recent">
          <thead>
            <tr>
              <th>Credit note</th>
              <th>Against bill</th>
              <th>Date</th>
              <th>By</th>
              <th>Approved by</th>
              <th className="num">Refund</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id}>
                <td>{r.returnNo}</td>
                <td>{r.billNo}</td>
                <td className="text-muted">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                <td>{r.userName}</td>
                <td className={r.approvedByName ? undefined : "text-muted"}>{r.approvedByName ?? "—"}</td>
                <td className="num">
                  {formatIndianCurrency(r.refundPaise)}
                  <div className="ret-sub">{REFUND_LABEL[r.refundMode]}</div>
                  {r.exchangeBillNo && (
                    <div className="ret-sub">
                      {formatIndianCurrency(r.exchangePaise)} on bill {r.exchangeBillNo}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {recent.length === 0 && <div className="empty-state">No returns recorded yet.</div>}
      </BlueprintCard>
      </div>

      {approvalOpen && (
        <ManagerApprovalDialog
          title="Manager approval"
          message={`A manager or owner must approve this refund of ${formatIndianCurrency(refundPaise)}.`}
          busy={busy}
          error={approvalError}
          onSubmit={(approver) => void handleSubmit(approver)}
          onCancel={() => {
            setApprovalOpen(false);
            setApprovalError(null);
          }}
        />
      )}
    </div>
  );
}
