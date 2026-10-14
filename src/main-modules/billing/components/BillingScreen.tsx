import { useCallback, useEffect, useRef, useState } from "react";
import {
  billingShortcutLabel,
  computeCartTotals,
  cycleBillIndex,
  findStockShortfalls,
  formatIndianCurrency,
  mrpLoweredText,
  topShortcutLayer,
} from "@pos/business-logic";
import type { BillingShortcutAction } from "@pos/business-logic";
import type { ApproverCredentials, Customer, DraftBill, PaymentInput } from "@pos/types";
import type { ExchangeReturnInput, NegativeStockPolicy } from "@shared/ipc.js";

import { creditService } from "@/services/creditService.js";
import { inventoryService } from "@/services/inventoryService.js";
import { printerService } from "@/services/printerService.js";
import { returnsService } from "@/services/returnsService.js";
import { storeSettingsService } from "@/services/storeSettingsService.js";
import { Icon } from "@/components/Icon/index.js";
import { ManagerApprovalDialog } from "@/components/ManagerApprovalDialog/ManagerApprovalDialog.js";
import { useSessionStore } from "@/store/sessionStore.js";
import { REFUND_LABEL, type PayoutMode } from "@/main-modules/returns/index.js";

import { useCartStore } from "../store/cartStore.js";
import type { PaymentShortcutHandle } from "../types.js";
import {
  BILLING_FOCUS_IDS,
  focusById,
  lineQtyInputId,
  paymentFieldId,
  useBillingShortcuts,
} from "../hooks/useBillingShortcuts.js";
import { billingService } from "../services/billingService.js";

import { BillActionsBar } from "./BillActionsBar.js";
import { CartPanel } from "./CartPanel.js";
import { CustomerBar } from "./CustomerBar.js";
import { ExchangeSettleModal } from "./ExchangeSettleModal.js";
import { PaymentModal } from "./PaymentModal.js";
import { RecoveryModal } from "./RecoveryModal.js";
import { ReturnAgainstBillModal } from "./ReturnAgainstBillModal.js";
import { SearchPanel } from "./SearchPanel.js";
import { ShortcutHelpOverlay, ShortcutKey } from "./ShortcutHelpOverlay.js";


/** Picks the colour of the last-message banner: a problem reads amber, anything else green. */
function messageTone(text: string): "ok" | "warn" {
  return /not added|unavailable/i.test(text) ? "warn" : "ok";
}

export function BillingScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const bills = useCartStore((s) => s.bills);
  const activeIndex = useCartStore((s) => s.activeIndex);
  const ensureAtLeastOneBill = useCartStore((s) => s.ensureAtLeastOneBill);
  const newBill = useCartStore((s) => s.newBill);
  const switchBill = useCartStore((s) => s.switchBill);
  const closeBill = useCartStore((s) => s.closeBill);
  const addProduct = useCartStore((s) => s.addProduct);
  const applyMrpCaps = useCartStore((s) => s.applyMrpCaps);
  const removeLine = useCartStore((s) => s.removeLine);
  const restoreCart = useCartStore((s) => s.restoreCart);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const setWholesale = useCartStore((s) => s.setWholesale);
  const resetActiveBillAfterSale = useCartStore((s) => s.resetActiveBillAfterSale);
  const setPendingReturn = useCartStore((s) => s.setPendingReturn);

  const [showPayment, setShowPayment] = useState(false);
  // True when the payment UI was opened for a refund with no new items on the bill (the
  // CartPanel's "Refund … (no new items)" button) — decides whether confirming goes through
  // the standalone returns:create channel instead of billingCreateSale (see Decision 4).
  const [refundOnlyMode, setRefundOnlyMode] = useState(false);
  const [showReturnPicker, setShowReturnPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftBill[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // A duplicate/merge/split/customer dialog from the bill actions bar is open.
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const handleBillDialogChange = useCallback((open: boolean) => setBillDialogOpen(open), []);
  // Set while a manager is asked to approve a below-cost discount, an exchange's return leg,
  // or a standalone refund-only settle: whatever was already confirmed, resent unchanged with
  // the manager's details once they're provided.
  const [pendingApproval, setPendingApproval] = useState<{
    kind: "sale" | "refundOnly";
    payments: PaymentInput[];
    payoutMode: PayoutMode | null;
    error: string | null;
  } | null>(null);
  // The attached customer's details and khata balance, per bill tab. Kept here rather than
  // in the cart because the cart stores only the id — these are display data that must be
  // re-read from the DB, not carried around in a draft.
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [stockPolicy, setStockPolicy] = useState<NegativeStockPolicy>("warn");
  const [stockLevels, setStockLevels] = useState<Record<string, number>>({});
  // Whether the open payment window would accept a confirm, published by the modal so the
  // Enter/F9 shortcut obeys exactly the rule its Confirm button does. Shared between
  // PaymentModal and ExchangeSettleModal — both publish the same {canConfirm, confirm} shape.
  const paymentShortcut = useRef<PaymentShortcutHandle | null>(null);
  // `submitting` state lags a render behind; two quick confirms (Enter then F9) would both
  // see it false and post the sale twice.
  const submittingRef = useRef(false);

  const billContext = context && user ? { storeId: context.storeId, counterId: context.counterId, userId: user.id } : null;

  useEffect(() => {
    if (billContext) ensureAtLeastOneBill(billContext);
  }, [billContext?.storeId, billContext?.counterId, billContext?.userId, ensureAtLeastOneBill]);

  useEffect(() => {
    if (!context) return;
    billingService
      .listDrafts(context.deviceId)
      .then((found) => {
        if (found.length > 0) {
          setDrafts(found);
          setShowRecovery(true);
        }
      })
      .catch(() => undefined);
  }, [context?.deviceId]);

  const activeBill = bills[activeIndex];

  // Autosave the active bill's cart after every change, so a crash never loses it.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!context || !activeBill) return;
    if (activeBill.cart.lines.length === 0) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      billingService
        .saveDraft({
          storeId: context.storeId,
          counterId: context.counterId,
          deviceId: context.deviceId,
          cart: activeBill.cart,
          label: activeBill.label,
        })
        .catch(() => undefined);
    }, 500);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [activeBill, context]);

  const attachedCustomerId = activeBill?.cart.customerId ?? null;
  const attachedCustomer = attachedCustomerId ? (customers[attachedCustomerId] ?? null) : null;
  const attachedBalance = attachedCustomerId ? (balances[attachedCustomerId] ?? 0) : 0;

  // A bill restored after a restart, or given a customer while it wasn't the active tab,
  // carries only the customer's id — read their details so the bar shows who it is.
  useEffect(() => {
    if (!attachedCustomerId || customers[attachedCustomerId]) return;
    let cancelled = false;
    billingService
      .getCustomer(attachedCustomerId)
      .then((found) => {
        if (found && !cancelled) setCustomers((prev) => ({ ...prev, [found.id]: found }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachedCustomerId, customers]);

  // Re-read the balance whenever a customer is attached, and again after every sale — what
  // they owe changes underneath this screen as bills are rung up.
  useEffect(() => {
    if (!attachedCustomerId) return;
    creditService
      .getBalance(attachedCustomerId)
      .then((balance) => setBalances((prev) => ({ ...prev, [attachedCustomerId]: balance })))
      .catch(() => undefined);
  }, [attachedCustomerId, lastMessage]);

  useEffect(() => {
    storeSettingsService.getNegativeStockPolicy().then(setStockPolicy).catch(() => undefined);
  }, []);

  // Re-read stock whenever the set of products on the bill changes, and after every sale.
  // Keyed on the sorted id list, so editing a quantity doesn't refetch.
  const cartProductKey = activeBill
    ? [...new Set(activeBill.cart.lines.map((l) => l.productId))].sort().join(",")
    : "";
  useEffect(() => {
    if (!context || cartProductKey === "") return;
    inventoryService
      .getStockLevels(context.storeId, cartProductKey.split(","))
      .then((levels) => setStockLevels((prev) => ({ ...prev, ...levels })))
      .catch(() => undefined);
  }, [context, cartProductKey, lastMessage]);

  // Re-checks every line's price against the MRP of the stock it would actually draw from.
  // Keyed on product+qty pairs (not price) so applying a cap here can't re-trigger itself —
  // a quantity can change via many paths (qty edit, merge, split, duplicate, draft restore),
  // not only the add-to-cart flow, so this is hooked to the cart's contents rather than to
  // any one of those actions.
  const cartProductQtyKey = activeBill
    ? [...activeBill.cart.lines]
        .filter((l) => l.qty > 0)
        .map((l) => `${l.productId}:${l.qty}`)
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    if (!context || cartProductQtyKey === "" || !activeBill) return;
    let cancelled = false;
    const clientTxnId = activeBill.cart.clientTxnId;
    const lines = activeBill.cart.lines
      .filter((l) => l.qty > 0)
      .map((l) => ({ productId: l.productId, qty: l.qty }));
    billingService
      .getMrpCaps(context.storeId, lines)
      .then((caps) => {
        if (cancelled) return;
        const lowered = applyMrpCaps(clientTxnId, caps);
        if (lowered.length > 0) setLastMessage(mrpLoweredText(lowered));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [context, cartProductQtyKey, activeBill?.cart.clientTxnId]);

  // Same rule the main process applies. Only lines whose stock has loaded are checked — a
  // product scanned a moment ago would otherwise read as zero on hand and flash a warning.
  // Worked out here rather than in CartPanel so the Payment button and F9 refuse by one rule.
  // A pending return's lines are added back onto on-hand first: those units are about to come
  // back onto the shelf when the sale is confirmed, so a same-product swap must not show as a
  // shortfall (mirrors the same bump salesRepo.createSale applies server-side).
  const effectiveStockLevels = activeBill?.pendingReturn
    ? (() => {
        const bumped = { ...stockLevels };
        for (const line of activeBill.pendingReturn.lines) {
          bumped[line.productId] = (bumped[line.productId] ?? 0) + line.qty;
        }
        return bumped;
      })()
    : stockLevels;
  const shortfalls =
    activeBill && stockPolicy !== "allow"
      ? findStockShortfalls(
          activeBill.cart.lines.filter((l) => l.productId in effectiveStockLevels),
          effectiveStockLevels,
        )
      : [];
  const checkoutBlocked = stockPolicy === "block" && shortfalls.length > 0;
  const lineCount = activeBill?.cart.lines.length ?? 0;
  const recoveryOpen = showRecovery && drafts.length > 0;

  useBillingShortcuts(
    () => ({
      layer: topShortcutLayer({
        help: showHelp,
        recovery: recoveryOpen,
        payment: showPayment,
        dialog: pendingApproval !== null || billDialogOpen || showReturnPicker,
      }),
      lineCount,
      billCount: bills.length,
      canCheckout: lineCount > 0 && !checkoutBlocked,
      canConfirmPayment: paymentShortcut.current?.canConfirm ?? false,
      paymentSubmitting: submitting,
    }),
    runShortcut,
  );

  function runShortcut(action: BillingShortcutAction): void {
    const lines = activeBill?.cart.lines ?? [];
    const lastLine = lines[lines.length - 1];
    switch (action) {
      case "toggleHelp":
        setShowHelp((open) => !open);
        return;
      case "closeHelp":
        setShowHelp(false);
        return;
      case "focusSearch":
        focusById(BILLING_FOCUS_IDS.search);
        return;
      case "focusCustomer":
        focusById(BILLING_FOCUS_IDS.customer);
        return;
      case "focusBillDiscount":
        focusById(BILLING_FOCUS_IDS.billDiscount);
        return;
      case "toggleWholesale":
        setWholesale(!(activeBill?.cart.isWholesale ?? false));
        return;
      case "focusLastLineQty":
        if (lastLine) focusById(lineQtyInputId(lastLine.lineId));
        return;
      case "removeLastLine":
        if (lastLine) removeLine(lastLine.lineId);
        return;
      case "newBill":
        handleNewBill();
        return;
      case "prevBill":
      case "nextBill":
        switchBill(cycleBillIndex(activeIndex, bills.length, action === "prevBill" ? -1 : 1));
        focusById(BILLING_FOCUS_IDS.search);
        return;
      case "openPayment":
        setRefundOnlyMode(false);
        setShowPayment(true);
        return;
      case "returnAgainstBill":
        setShowReturnPicker(true);
        return;
      case "focusCash":
        focusById(paymentFieldId("cash"));
        return;
      case "focusUpi":
        focusById(paymentFieldId("upi"));
        return;
      case "focusCard":
        focusById(paymentFieldId("card"));
        return;
      case "focusCredit":
        focusById(paymentFieldId("credit"));
        return;
      case "confirmPayment":
        paymentShortcut.current?.confirm();
        return;
      case "cancelPayment":
        closePayment();
        return;
      case "closeRecovery":
        setShowRecovery(false);
        focusById(BILLING_FOCUS_IDS.search);
        return;
    }
  }

  function handleNewBill(): void {
    if (!billContext) return;
    newBill(billContext);
    focusById(BILLING_FOCUS_IDS.search);
  }

  function closePayment(): void {
    setShowPayment(false);
    setRefundOnlyMode(false);
    setPaymentError(null);
    setPendingApproval(null);
    focusById(BILLING_FOCUS_IDS.search);
  }

  function handleAttachCustomer(customer: Customer): void {
    setCustomers((prev) => ({ ...prev, [customer.id]: customer }));
    setCustomer(customer.id);
  }

  function handleRestore(draft: DraftBill): void {
    restoreCart(draft.cart, draft.label ?? "Restored bill");
    setDrafts((prev) => prev.filter((d) => d.clientTxnId !== draft.clientTxnId));
    if (drafts.length <= 1) {
      setShowRecovery(false);
      focusById(BILLING_FOCUS_IDS.search);
    }
  }

  function handleDiscard(draft: DraftBill): void {
    billingService.deleteDraft(draft.clientTxnId).catch(() => undefined);
    setDrafts((prev) => prev.filter((d) => d.clientTxnId !== draft.clientTxnId));
    if (drafts.length <= 1) {
      setShowRecovery(false);
      focusById(BILLING_FOCUS_IDS.search);
    }
  }

  async function handleConfirmPayment(
    payments: PaymentInput[],
    approver: ApproverCredentials | null = null,
    payoutMode: PayoutMode | null = null,
  ): Promise<void> {
    if (!activeBill || !billContext || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setPaymentError(null);
    // Captured up front: resetActiveBillAfterSale clears activeBill.pendingReturn on success,
    // so the success message below needs its own snapshot rather than re-reading the tab.
    const pendingReturnForSale = activeBill.pendingReturn ?? null;
    // Same reason: resetActiveBillAfterSale also clears the bill's customer, so the change
    // suffix below needs its own snapshot of who was on the bill.
    const customerNameForSale = attachedCustomer?.name ?? null;
    try {
      const exchange: ExchangeReturnInput | null = pendingReturnForSale
        ? {
            originalSaleId: pendingReturnForSale.originalSaleId,
            lines: pendingReturnForSale.lines.map((l) => ({ saleItemId: l.saleItemId, qty: l.qty })),
            reason: pendingReturnForSale.reason,
            payoutMode,
          }
        : null;
      // Same cart, same clientTxnId on the resend — the server answers a repeat with the bill
      // it already wrote, so an approval that raced a retry can't bill twice.
      const response = await billingService.createSale(activeBill.cart, payments, approver, exchange);
      if (!response.ok || !response.result) {
        if (response.mrpCaps) {
          // The server wrote nothing and lowered nothing itself — it refused and handed back
          // the caps so the correction happens here, before the cashier is asked to confirm
          // payment again against the corrected (lower) total.
          applyMrpCaps(activeBill.cart.clientTxnId, response.mrpCaps);
          setPendingApproval(null);
          setPaymentError(response.error ?? "Could not complete the sale.");
          return;
        }
        if (response.returnInvalid) {
          // Nothing was written. Only the pending return is cleared — the cart's new items
          // stay exactly as they were, so the cashier doesn't lose the bill they were ringing up.
          setPendingReturn(activeBill.cart.clientTxnId, null);
          setPendingApproval(null);
          setShowPayment(false);
          setLastMessage(
            `Return not added: ${response.error ?? "it could not be recorded."} The new items are still on the bill — press F12 to look the bill up again.`,
          );
          return;
        }
        if (response.approvalRequired) {
          // First ask: no error in the dialog, the discount/return reason is shown there instead.
          setPendingApproval({ kind: "sale", payments, payoutMode, error: approver ? (response.error ?? null) : null });
          if (!approver) setPaymentError(response.error ?? null);
          return;
        }
        setPendingApproval(null);
        setPaymentError(response.error ?? "Could not complete the sale.");
        return;
      }

      setPendingApproval(null);
      setShowPayment(false);
      setRefundOnlyMode(false);
      const billNo = response.result.sale.billNo;
      resetActiveBillAfterSale(billContext);

      // The cash leg actually sent, if cash was overpaid — shared by both success messages
      // below rather than duplicated per branch.
      const cashLeg = payments.find((p) => p.mode === "cash" && p.tenderedPaise != null);
      let changeSuffix = "";
      if (cashLeg) {
        const changePaise = cashLeg.tenderedPaise! - cashLeg.amountPaise;
        changeSuffix =
          cashLeg.changeAction === "khata"
            ? ` ${formatIndianCurrency(changePaise)} change kept on ${customerNameForSale ?? "the customer"}'s khata.`
            : ` Give ${formatIndianCurrency(changePaise)} change.`;

        // Reflects the new balance after the khata entry createSale just wrote — but only if
        // the (now-reset) bill's tab still has a customer attached; resetActiveBillAfterSale
        // clears it on every tab today, so this is a no-op unless that ever changes.
        if (cashLeg.changeAction === "khata") {
          const stillAttached = useCartStore.getState().bills[activeIndex]?.cart.customerId;
          if (stillAttached) {
            creditService
              .getBalance(stillAttached)
              .then((balance) => setBalances((prev) => ({ ...prev, [stillAttached]: balance })))
              .catch(() => undefined);
          }
        }
      }

      if (pendingReturnForSale && response.returnNo) {
        const R = pendingReturnForSale.refundPaise;
        const payout = Math.max(0, R - response.result.sale.netPaise);
        let message = `Bill ${billNo} completed. Return ${response.returnNo} from bill ${pendingReturnForSale.originalBillNo} set off ${formatIndianCurrency(R)}.`;
        if (payout > 0 && payoutMode) {
          message += ` Give the customer ${formatIndianCurrency(payout)} (${REFUND_LABEL[payoutMode]}).`;
        }
        setLastMessage(`${message}${changeSuffix}`);
      } else {
        setLastMessage(`Bill ${billNo} completed.${changeSuffix}`);
      }
      // Straight back to scanning — the next customer is already at the counter.
      focusById(BILLING_FOCUS_IDS.search);

      const printResult = await printerService.printReceipt(response.result.sale.id, billContext.userId);
      if (!printResult.ok) {
        setLastMessage(
          `Bill ${billNo} completed. Printer unavailable: ${printResult.error ?? "unknown error"}. You can reprint from Sales.`,
        );
      }
    } catch {
      setPaymentError("Could not reach the local service. The bill was not saved — please retry.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  /** The empty-cart path (Decision 4): a pending return with no new items goes straight
   * through the existing standalone returns:create channel — there's no new bill to print it
   * on, so the credit note is the correct and only record, exactly like the Returns screen. */
  async function handleRefundOnly(mode: PayoutMode, approver: ApproverCredentials | null = null): Promise<void> {
    const pendingReturnForSale = activeBill?.pendingReturn ?? null;
    if (!activeBill || !billContext || !pendingReturnForSale || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setPaymentError(null);
    try {
      const result = await returnsService.create({
        storeId: billContext.storeId,
        counterId: billContext.counterId,
        saleId: pendingReturnForSale.originalSaleId,
        userId: billContext.userId,
        clientTxnId: activeBill.cart.clientTxnId,
        reason: pendingReturnForSale.reason,
        refundMode: mode,
        lines: pendingReturnForSale.lines.map((l) => ({ saleItemId: l.saleItemId, qty: l.qty })),
        approver,
      });

      if (!result.ok) {
        if (result.approvalRequired) {
          setPendingApproval({ kind: "refundOnly", payments: [], payoutMode: mode, error: approver ? (result.error ?? null) : null });
          if (!approver) setPaymentError(result.error ?? null);
          return;
        }
        setPendingApproval(null);
        setPaymentError(result.error ?? "Could not record the return.");
        return;
      }

      setPendingApproval(null);
      setShowPayment(false);
      setRefundOnlyMode(false);
      billingService.deleteDraft(activeBill.cart.clientTxnId).catch(() => undefined);
      resetActiveBillAfterSale(billContext);
      setLastMessage(
        `Credit note ${result.returnNo} — ${formatIndianCurrency(pendingReturnForSale.refundPaise)} refunded ${
          mode === "credit" ? "to khata" : "in cash/upi/card"
        }.`,
      );
      focusById(BILLING_FOCUS_IDS.search);
    } catch {
      setPaymentError("Could not reach the local service. The return was not saved — please retry.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!context || !user || !activeBill) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  return (
    <div
      className="billing-screen"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      <div className="bill-tabs-row">
        <div className="bill-tabs">
          {bills.map((bill, index) => (
            <button
              key={bill.cart.clientTxnId}
              className={`bill-tab ${index === activeIndex ? "active" : ""}`}
              aria-pressed={index === activeIndex}
              title={`${billingShortcutLabel("prevBill")} / ${billingShortcutLabel("nextBill")} to switch bills`}
              onClick={() => switchBill(index)}
            >
              {bill.label} ({bill.cart.lines.length}){bill.pendingReturn ? " · return" : ""}
              {bills.length > 1 && (
                <span
                  className="bill-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeBill(index);
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          ))}
          <button className="bill-tab" onClick={handleNewBill}>
            + New Bill <ShortcutKey action="newBill" />
          </button>
        </div>
        <button className="btn btn-ghost shortcut-help-toggle" onClick={() => setShowHelp(true)}>
          Shortcuts <ShortcutKey action="toggleHelp" />
        </button>
      </div>

      {context && (
        <BillActionsBar
          context={context}
          customers={customers}
          onDialogChange={handleBillDialogChange}
          onCustomerAssigned={(customer) => setCustomers((prev) => ({ ...prev, [customer.id]: customer }))}
          onMessage={setLastMessage}
          onOpenReturn={() => setShowReturnPicker(true)}
        />
      )}

      {lastMessage && (
        <div className={"billing-message " + messageTone(lastMessage)} role="status">
          <Icon name={messageTone(lastMessage) === "warn" ? "alert" : "check"} />
          <span>{lastMessage}</span>
        </div>
      )}

      <CustomerBar
        storeId={context.storeId}
        customer={attachedCustomer}
        balancePaise={attachedBalance}
        onAttach={handleAttachCustomer}
        onClear={() => setCustomer(null)}
      />

      <SearchPanel storeId={context.storeId} onAddProduct={addProduct} />

      <div className="billing-layout">
        <CartPanel
          cart={activeBill.cart}
          shortfalls={shortfalls}
          checkoutBlocked={checkoutBlocked}
          stockPolicy={stockPolicy}
          onCheckout={() => {
            setRefundOnlyMode(false);
            setShowPayment(true);
          }}
          pendingReturn={activeBill.pendingReturn ?? null}
          onRemoveReturn={() => setPendingReturn(activeBill.cart.clientTxnId, null)}
          onRefundOnly={() => {
            setRefundOnlyMode(true);
            setShowPayment(true);
          }}
        />
      </div>

      {showPayment &&
        (() => {
          const pendingReturn = activeBill.pendingReturn ?? null;
          const newItemsPaise = computeCartTotals(activeBill.cart, {
            costPricePaiseByProduct: {},
            allowBelowCost: true,
          }).totals.netPaise;
          const refundPaise = pendingReturn?.refundPaise ?? 0;
          const dueNow = pendingReturn ? newItemsPaise - refundPaise : newItemsPaise;

          if (pendingReturn && (refundOnlyMode || dueNow <= 0)) {
            return (
              <ExchangeSettleModal
                refundPaise={refundPaise}
                newItemsPaise={refundOnlyMode ? 0 : newItemsPaise}
                originalBillNo={pendingReturn.originalBillNo}
                originalCustomerName={pendingReturn.originalCustomerName}
                khataAvailable={pendingReturn.originalCustomerId !== null}
                defaultMode={
                  pendingReturn.hadCreditPayment && pendingReturn.originalCustomerId !== null ? "credit" : "cash"
                }
                submitting={submitting}
                error={paymentError}
                onCancel={closePayment}
                onConfirm={(mode) =>
                  void (refundOnlyMode ? handleRefundOnly(mode ?? "cash", null) : handleConfirmPayment([], null, mode))
                }
                shortcutRef={paymentShortcut}
              />
            );
          }

          return (
            <PaymentModal
              // Remounts the cash-tendered field at the corrected total whenever an MRP cap
              // (or a pending return) changes the amount actually due after the modal was
              // already open, rather than keeping a stale pre-filled amount.
              key={dueNow}
              netPaise={dueNow}
              customerId={attachedCustomerId}
              customerName={attachedCustomer?.name ?? null}
              customerBalancePaise={attachedBalance}
              creditLimitPaise={attachedCustomer?.creditLimitPaise ?? 0}
              onCancel={closePayment}
              onConfirm={(payments) => void handleConfirmPayment(payments, null, null)}
              submitting={submitting}
              error={paymentError}
              shortcutRef={paymentShortcut}
              note={
                pendingReturn
                  ? `New items ${formatIndianCurrency(newItemsPaise)} − return ${formatIndianCurrency(refundPaise)} (bill ${pendingReturn.originalBillNo})`
                  : null
              }
            />
          );
        })()}

      {recoveryOpen && (
        <RecoveryModal
          drafts={drafts}
          onRestore={handleRestore}
          onDiscard={handleDiscard}
          onClose={() => {
            setShowRecovery(false);
            focusById(BILLING_FOCUS_IDS.search);
          }}
        />
      )}

      {showHelp && <ShortcutHelpOverlay onClose={() => setShowHelp(false)} />}

      {showReturnPicker && (
        <ReturnAgainstBillModal
          storeId={context.storeId}
          existingReturnBillNo={activeBill.pendingReturn?.originalBillNo ?? null}
          onAdd={(pr) => {
            setPendingReturn(activeBill.cart.clientTxnId, pr);
            setShowReturnPicker(false);
            focusById(BILLING_FOCUS_IDS.search);
          }}
          onCancel={() => setShowReturnPicker(false)}
        />
      )}

      {pendingApproval && (
        <ManagerApprovalDialog
          title="Manager approval"
          message={
            pendingApproval.kind === "refundOnly"
              ? `A manager or owner must approve this refund of ${formatIndianCurrency(activeBill.pendingReturn?.refundPaise ?? 0)}.`
              : activeBill.pendingReturn
                ? `This bill takes back items from bill ${activeBill.pendingReturn.originalBillNo} (${formatIndianCurrency(activeBill.pendingReturn.refundPaise)}). A manager or owner must approve the return before the bill is saved.`
                : "This discount prices an item below its cost. A manager or owner must approve it before the bill is saved."
          }
          busy={submitting}
          error={pendingApproval.error}
          onSubmit={(approver) =>
            pendingApproval.kind === "refundOnly"
              ? void handleRefundOnly((pendingApproval.payoutMode as PayoutMode) ?? "cash", approver)
              : void handleConfirmPayment(pendingApproval.payments, approver, pendingApproval.payoutMode)
          }
          onCancel={() => setPendingApproval(null)}
        />
      )}
    </div>
  );
}
