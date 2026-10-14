import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  buildTenderPayments,
  canKeepChangeOnKhata,
  computeTender,
  creditPortionPaise,
  creditRejectionReason,
  formatIndianCurrency,
  PAYMENT_MODE_SHORTCUT,
} from "@pos/business-logic";
import type { ChangeAction, PaymentInput } from "@pos/types";

import { parseRupeesOrZero } from "@/utils/money.js";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";
import { paymentFieldId } from "./useBillingShortcuts.js";

/** What the billing screen's keyboard layer needs from an open payment window. */
export interface PaymentShortcutHandle {
  canConfirm: boolean;
  confirm: () => void;
}

interface PaymentModalProps {
  netPaise: number;
  customerId: string | null;
  /** Shown in the "Keep on khata" choice, e.g. "Keep on khata (Lakshmi)". */
  customerName: string | null;
  customerBalancePaise: number;
  creditLimitPaise: number;
  onCancel: () => void;
  onConfirm: (payments: PaymentInput[]) => void;
  submitting: boolean;
  error: string | null;
  shortcutRef: MutableRefObject<PaymentShortcutHandle | null>;
  /** Shown under the title, e.g. the breakdown behind a reduced total on an exchange bill. */
  note?: string | null;
}

const MODES: PaymentInput["mode"][] = ["cash", "upi", "card", "credit"];

const MODE_LABEL: Record<PaymentInput["mode"], string> = {
  cash: "CASH",
  upi: "UPI",
  card: "CARD",
  credit: "CREDIT (KHATA)",
};

export function PaymentModal({
  netPaise,
  customerId,
  customerName,
  customerBalancePaise,
  creditLimitPaise,
  onCancel,
  onConfirm,
  submitting,
  error,
  shortcutRef,
  note,
}: PaymentModalProps): JSX.Element {
  const [amounts, setAmounts] = useState<Record<PaymentInput["mode"], string>>({
    cash: (netPaise / 100).toFixed(2),
    upi: "",
    card: "",
    credit: "",
  });
  // Null until the cashier picks, when a choice is actually needed (Decision 4) — remounted
  // via the existing key={dueNow} mechanism on a total change, which correctly resets this.
  const [changeAction, setChangeAction] = useState<ChangeAction | null>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  const amountsPaise = {
    cash: Math.max(0, parseRupeesOrZero(amounts.cash)),
    upi: Math.max(0, parseRupeesOrZero(amounts.upi)),
    card: Math.max(0, parseRupeesOrZero(amounts.card)),
    credit: Math.max(0, parseRupeesOrZero(amounts.credit)),
  };
  const t = computeTender(netPaise, amountsPaise);
  const khataAllowed = canKeepChangeOnKhata({ customerId, creditPaise: amountsPaise.credit });
  // Not offered (no customer, or a credit portion): change is implicitly handed back, no
  // click needed. Offered: the cashier must pick explicitly — stays null until they do.
  const effectiveChangeAction: ChangeAction | null = t.changePaise > 0 ? (khataAllowed ? changeAction : "handback") : null;
  const payments = buildTenderPayments(amountsPaise, t, effectiveChangeAction);

  // The same rule the main process enforces, run here so the cashier is told before they
  // commit rather than after. The server still re-checks — this is a courtesy, not a guard.
  const creditRejection = creditRejectionReason({
    balancePaise: customerBalancePaise,
    creditLimitPaise,
    creditAmountPaise: creditPortionPaise(payments),
    customerId,
  });

  const canConfirm =
    !submitting && t.balancePaise === 0 && creditRejection === null && (t.changePaise === 0 || effectiveChangeAction !== null);

  function handleConfirm(): void {
    onConfirm(payments);
  }

  // Republished after every render so a keyboard confirm always sends the amounts on screen.
  useEffect(() => {
    shortcutRef.current = { canConfirm, confirm: handleConfirm };
    return () => {
      shortcutRef.current = null;
    };
  });

  // Cash opens selected: most bills are exact cash (Enter), and typing replaces the amount
  // for a split.
  useEffect(() => {
    cashRef.current?.focus();
    cashRef.current?.select();
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal-card payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" ref={cardRef}>
        <h2 id="payment-title">Payment — {formatIndianCurrency(netPaise)}</h2>
        {note && <div className="text-muted">{note}</div>}
        <div className="payment-fields">
          {MODES.map((mode) => (
            <div className="field" key={mode}>
              <label htmlFor={paymentFieldId(mode)}>
                {mode === "cash" && t.changePaise > 0 ? "CASH TENDERED" : MODE_LABEL[mode]}{" "}
                <ShortcutKey action={PAYMENT_MODE_SHORTCUT[mode]} />
                {mode === "credit" && customerBalancePaise > 0 && (
                  <span className="text-muted"> · already owes {formatIndianCurrency(customerBalancePaise)}</span>
                )}
              </label>
              <input
                id={paymentFieldId(mode)}
                ref={mode === "cash" ? cashRef : undefined}
                type="number"
                min={0}
                step={0.01}
                value={amounts[mode]}
                onChange={(e) => setAmounts((prev) => ({ ...prev, [mode]: e.target.value }))}
              />
              {mode === "cash" && t.changePaise > 0 && (
                <div className="change-due">
                  <div className="row">
                    <strong>Change due</strong>
                    <strong className="change-amount">{formatIndianCurrency(t.changePaise)}</strong>
                  </div>
                  {khataAllowed ? (
                    <>
                      <div className="change-choice" role="group" aria-label="What to do with the change">
                        <button
                          type="button"
                          aria-pressed={changeAction === "handback"}
                          onClick={() => setChangeAction("handback")}
                        >
                          Hand back in cash
                        </button>
                        <button
                          type="button"
                          aria-pressed={changeAction === "khata"}
                          onClick={() => setChangeAction("khata")}
                        >
                          Keep on khata ({customerName ?? "customer"})
                        </button>
                      </div>
                      {changeAction === null && <div className="text-muted">Choose one to continue.</div>}
                    </>
                  ) : (
                    <div className="text-muted">
                      Hand back in cash.{" "}
                      {customerId === null
                        ? "No customer on this bill, so the change can't go to khata."
                        : "Part of this bill is on credit — reduce the credit instead of keeping change on khata."}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {creditRejection && <div className="error-text">{creditRejection}</div>}
        <div className="payment-balance">
          <strong>Balance</strong>
          <strong className={t.balancePaise === 0 ? undefined : "payment-owed"}>
            {formatIndianCurrency(t.balancePaise)}
          </strong>
        </div>
        {t.balancePaise < 0 && (
          <div className="text-muted">
            {t.nonCashPaise > netPaise
              ? "UPI, card and credit can't add up to more than the bill — only cash can be more."
              : t.strayCashPaise > 0
                ? "Nothing is left to pay in cash — clear the cash box."
                : null}
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
                Confirm Payment <ShortcutKey action="confirmPayment" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
