import { useEffect, useRef, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { ReturnableSale } from "@pos/types";

import { returnsService } from "@/services/returnsService.js";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import type { PendingReturn } from "../../store/cartStore.js";
import { previewReturn, ReturnLinePicker } from "../returns/ReturnLinePicker.js";

interface ReturnAgainstBillModalProps {
  storeId: string;
  /** The bill number of the return already on this tab, if there is one — shown as a warning
   * that adding a new one replaces it (Decision 3: at most one pending return per bill tab). */
  existingReturnBillNo: string | null;
  onAdd: (pr: PendingReturn) => void;
  onCancel: () => void;
}

/**
 * "Return item…" (F12) on the Billing screen: look up an earlier bill and pick what's coming
 * back. Unlike the standalone Returns screen, nothing is sent to the server here — the pick
 * becomes this tab's `pendingReturn`, and its value only leaves the drawer (or offsets what's
 * owed) once the cashier takes payment on this bill.
 */
export function ReturnAgainstBillModal({
  storeId,
  existingReturnBillNo,
  onAdd,
  onCancel,
}: ReturnAgainstBillModalProps): JSX.Element {
  const [billNo, setBillNo] = useState("");
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function handleLookup(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLookupError(null);
    setSale(null);
    setQtys({});
    setBusy(true);
    const found = await returnsService.lookup(storeId, billNo.trim());
    setBusy(false);
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
  }

  const { selected, refundPaise, previewError } = sale
    ? previewReturn(sale, qtys)
    : { selected: [], refundPaise: 0, previewError: null };

  function handleAdd(): void {
    if (!sale || selected.length === 0 || previewError) return;
    onAdd({
      originalSaleId: sale.saleId,
      originalBillNo: sale.billNo,
      originalCustomerId: sale.customerId,
      originalCustomerName: sale.customerName,
      hadCreditPayment: sale.hadCreditPayment,
      lines: selected.map(({ line, qty }) => ({
        saleItemId: line.saleItemId,
        productId: line.productId,
        productName: line.productName,
        uom: line.uom,
        qty,
      })),
      reason: reason.trim() === "" ? null : reason.trim(),
      refundPaise,
    });
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card return-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-against-bill-title"
        ref={cardRef}
      >
        <h2 id="return-against-bill-title">Return items on this bill</h2>
        <p className="text-muted">
          Find the earlier bill and pick what&apos;s coming back. Its value comes off this bill when you take payment.
        </p>

        <form onSubmit={handleLookup} className="return-lookup">
          <div className="field">
            <label htmlFor="exchange-return-bill-no">Earlier bill number</label>
            <input
              id="exchange-return-bill-no"
              value={billNo}
              placeholder="POS-20261005-12"
              onChange={(e) => setBillNo(e.target.value)}
              autoFocus
            />
          </div>
          <button className="secondary-btn" type="submit" disabled={billNo.trim() === "" || busy}>
            Find bill
          </button>
        </form>
        {lookupError && <div className="error-text">{lookupError}</div>}

        {sale && (
          <>
            <div className="return-bill-pill">
              {sale.billNo} · {new Date(sale.createdAt).toLocaleString("en-IN")} · {sale.customerName ?? "Walk-in"} ·
              billed {formatIndianCurrency(sale.netPaise)}
            </div>

            <ReturnLinePicker
              sale={sale}
              qtys={qtys}
              onQtyChange={(saleItemId, value) => setQtys((prev) => ({ ...prev, [saleItemId]: value }))}
            />

            <div className="field">
              <label htmlFor="exchange-return-reason">Reason (optional)</label>
              <input
                id="exchange-return-reason"
                value={reason}
                maxLength={200}
                placeholder="Damaged, wrong item, changed mind…"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {previewError && <div className="error-text">{previewError}</div>}

            {existingReturnBillNo && (
              <div className="text-muted return-replace-note">
                This replaces the return already on this bill (from {existingReturnBillNo}).
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!sale || selected.length === 0 || previewError !== null}
            onClick={handleAdd}
          >
            Add return to bill ({formatIndianCurrency(refundPaise)})
          </button>
        </div>
      </div>
    </div>
  );
}
