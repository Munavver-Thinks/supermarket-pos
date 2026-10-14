import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { formatIndianCurrency } from "@pos/business-logic";

import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";
import type { PayoutMode } from "@/main-menus/returns/index.js";

import type { ExchangeSettleShortcutHandle } from "../types.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";

interface ExchangeSettleModalProps {
  /** R: the return's refund value. */
  refundPaise: number;
  /** N: the new items' own net. 0 for a refund-only settle (empty cart). */
  newItemsPaise: number;
  originalBillNo: string;
  originalCustomerName: string | null;
  khataAvailable: boolean;
  defaultMode: PayoutMode;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  /** Null when there's nothing to pay out (N === R) — the return fully and exactly covers the
   * new items, refundMode is "exchange" and no payout mode is asked for. */
  onConfirm: (mode: PayoutMode | null) => void;
  shortcutRef: MutableRefObject<ExchangeSettleShortcutHandle | null>;
}

const PAYOUT_SELECT_MODES: PayoutMode[] = ["cash", "upi", "card", "credit"];

/**
 * Shown instead of PaymentModal whenever a pending return is worth at least as much as the
 * new items (N ≤ R): there's nothing, or nothing more than the leftover, to take payment for
 * — only how to give the difference back needs deciding.
 */
export function ExchangeSettleModal({
  refundPaise,
  newItemsPaise,
  originalBillNo,
  originalCustomerName,
  khataAvailable,
  defaultMode,
  submitting,
  error,
  onCancel,
  onConfirm,
  shortcutRef,
}: ExchangeSettleModalProps): JSX.Element {
  const payoutPaise = refundPaise - newItemsPaise;
  const [mode, setMode] = useState<PayoutMode>(defaultMode);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  const canConfirm = !submitting && (payoutPaise === 0 || !(mode === "credit" && !khataAvailable));

  function handleConfirm(): void {
    onConfirm(payoutPaise === 0 ? null : mode);
  }

  useEffect(() => {
    shortcutRef.current = { canConfirm, confirm: handleConfirm };
    return () => {
      shortcutRef.current = null;
    };
  });

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card settle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exchange-settle-title"
        ref={cardRef}
      >
        <h2 id="exchange-settle-title">
          {payoutPaise > 0 ? `Give back — ${formatIndianCurrency(payoutPaise)}` : "Settle exchange"}
        </h2>

        <div className="settle-rows">
          <div className="settle-row">
            <span>Returned from bill {originalBillNo}</span>
            <span>{formatIndianCurrency(refundPaise)}</span>
          </div>
          <div className="settle-row">
            <span>{newItemsPaise > 0 ? "New items" : "No new items"}</span>
            <span>{newItemsPaise > 0 ? formatIndianCurrency(newItemsPaise) : ""}</span>
          </div>
        </div>
        <div className="settle-total">
          <strong>Give back to customer</strong>
          <strong className="settle-total-amount">{formatIndianCurrency(payoutPaise)}</strong>
        </div>

        {payoutPaise > 0 && (
          <div className="field">
            <label htmlFor="exchange-payout-mode">Give back as</label>
            <select
              id="exchange-payout-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PayoutMode)}
            >
              {PAYOUT_SELECT_MODES.map((m) => (
                <option key={m} value={m} disabled={m === "credit" && !khataAvailable}>
                  {m === "credit"
                    ? `To khata${originalCustomerName ? ` (${originalCustomerName})` : ""}`
                    : m === "cash"
                      ? "Cash"
                      : m === "upi"
                        ? "UPI"
                        : "Card"}
                </option>
              ))}
            </select>
            {mode === "credit" && !khataAvailable && (
              <div className="text-muted">
                Bill {originalBillNo} has no customer, so there is no khata to refund to.
              </div>
            )}
          </div>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button className="secondary-btn" onClick={onCancel} disabled={submitting}>
            Cancel <ShortcutKey action="cancelPayment" />
          </button>
          <button className="primary-btn" disabled={!canConfirm} onClick={handleConfirm}>
            {submitting ? (
              "Processing..."
            ) : (
              <>
                Confirm <ShortcutKey action="confirmPayment" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
