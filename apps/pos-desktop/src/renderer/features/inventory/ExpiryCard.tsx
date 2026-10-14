import { useCallback, useEffect, useRef, useState } from "react";
import { canApprove, EXPIRY_ALERT_DAYS, formatIndianCurrency } from "@pos/business-logic";
import type { ApproverCredentials, ExpiringBatchRow } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { ManagerApprovalDialog } from "../../components/ManagerApprovalDialog.js";
import { useSessionStore } from "../../store/sessionStore.js";

interface ExpiryCardProps {
  /** Bumped by the screen when stock changed elsewhere, to reload the list. */
  refreshKey: number;
  onChanged: () => void;
}

/**
 * Batches that are past their date, or will be within the alert window. Expired stock can be
 * written off from here; that takes the batch's remaining quantity off the shelf count and,
 * for inventory staff, needs a manager to approve.
 */
export function ExpiryCard({ refreshKey, onChanged }: ExpiryCardProps): JSX.Element | null {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const [rows, setRows] = useState<ExpiringBatchRow[] | null>(null);
  const [target, setTarget] = useState<ExpiringBatchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);

  const load = useCallback(() => {
    if (!context) return;
    window.api.batches
      .listExpiring(context.storeId, EXPIRY_ALERT_DAYS)
      .then(setRows)
      .catch(() => setRows([]));
  }, [context]);

  useEffect(load, [load, refreshKey]);

  if (!context || !user) return null;
  const needsApproval = !canApprove(user.role, "stock_adjustment");

  async function startWriteOff(row: ExpiringBatchRow): Promise<void> {
    if (confirmingRef.current) return;
    setMessage(null);
    const what = `${row.qtyRemaining} ${row.uom} of ${row.productName}${row.batchNo ? ` (batch ${row.batchNo})` : ""}`;
    confirmingRef.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: `Write off ${what}?`,
        message: "This takes it off the stock count.",
        cancelLabel: "Keep",
        confirmLabel: "Write off",
      });
    } finally {
      confirmingRef.current = false;
    }
    if (!ok) return;
    setTarget(row);
    if (needsApproval) {
      setApprovalError(null);
      setApprovalOpen(true);
      return;
    }
    void submit(row, null);
  }

  async function submit(row: ExpiringBatchRow, approver: ApproverCredentials | null): Promise<void> {
    if (!user) return;
    setBusy(true);
    const result = await window.api.batches.writeOff({
      batchId: row.batchId,
      actingUserId: user.id,
      note: `Expired ${row.expiryDate}`,
      approver,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.approvalRequired) {
        setApprovalError(approver ? (result.error ?? null) : null);
        setApprovalOpen(true);
        return;
      }
      setApprovalOpen(false);
      setTarget(null);
      setMessage(result.error ?? "Could not write off the batch.");
      return;
    }
    setApprovalOpen(false);
    setTarget(null);
    setMessage(`Written off ${result.qty ?? row.qtyRemaining} ${row.uom} of ${row.productName}.`);
    load();
    onChanged();
  }

  return (
    <BlueprintCard>
      <h2>Expiry</h2>
      <p className="note inv-lead">
        Batches with stock left that are past their date or expire within {EXPIRY_ALERT_DAYS} days. Only stock received
        with an expiry date is tracked here.
      </p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Product · batch</th>
              <th>Expiry</th>
              <th className="num">Left</th>
              <th className="num">Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.batchId}>
                <td>
                  {row.productName}
                  {row.batchNo && <div className="note">{row.batchNo}</div>}
                </td>
                <td>
                  <span className={"pill " + (row.status === "expired" ? "bad" : "warn")}>
                    {row.status === "expired" ? "Expired" : "Expiring"} {row.expiryDate}
                  </span>
                </td>
                <td className="num">
                  {row.qtyRemaining} {row.uom}
                </td>
                <td className="num">{formatIndianCurrency(row.valuePaise)}</td>
                <td className="r">
                  {row.status === "expired" && (
                    <button
                      type="button"
                      className="btn btn-ghost p5b-danger-text"
                      disabled={busy}
                      onClick={() => void startWriteOff(row)}
                    >
                      Write off
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">
                  Nothing expired or expiring soon.
                </td>
              </tr>
            )}
            {rows === null && (
              <tr>
                <td colSpan={5} className="text-muted">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {message && <div className="p5b-msg">{message}</div>}
      {approvalOpen && target && (
        <ManagerApprovalDialog
          title="Manager approval"
          message={`A manager or owner must approve writing off ${target.qtyRemaining} ${target.uom} of ${target.productName}.`}
          busy={busy}
          error={approvalError}
          onSubmit={(approver) => void submit(target, approver)}
          onCancel={() => {
            setApprovalOpen(false);
            setApprovalError(null);
            setTarget(null);
          }}
        />
      )}
    </BlueprintCard>
  );
}
