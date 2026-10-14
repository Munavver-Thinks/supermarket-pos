import { useEffect, useRef, useState } from "react";
import { canApprove, isFractionalUom, roundQtyForUom } from "@pos/business-logic";
import type { ApproverCredentials, StockMovementReason } from "@pos/types";

import { inventoryService } from "@/services/inventoryService.js";
import { ManagerApprovalDialog } from "@/components/ManagerApprovalDialog/ManagerApprovalDialog.js";
import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

import { useSessionStore } from "../../store/sessionStore.js";

import { ProductPicker, type PickedProduct } from "./ProductPicker.js";

type AdjustmentReason = Extract<
  StockMovementReason,
  "manual_stock_in" | "adjustment_damaged" | "adjustment_missing" | "adjustment_correction" | "adjustment_expired"
>;

interface StockAdjustModalProps {
  /** A product chosen from a table's Adjust button; replaces whatever is picked. Null opens
   * the modal empty, ready to pick anything, for the top-of-screen "Adjust Stock" button. */
  preset: PickedProduct | null;
  onSaved: () => void;
  onClose: () => void;
}

/** Stays open after a successful save, reset and ready to adjust the next product — closing
 * is a deliberate Close, not an automatic side effect of saving. */
export function StockAdjustModal({ preset, onSaved, onClose }: StockAdjustModalProps): JSX.Element | null {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const [product, setProduct] = useState<PickedProduct | null>(preset);
  const [qtyAfter, setQtyAfter] = useState(preset ? String(Math.max(preset.stockOnHand, 0)) : "");
  const [reason, setReason] = useState<AdjustmentReason>("adjustment_correction");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    if (!preset) return;
    setProduct(preset);
    setQtyAfter(String(Math.max(preset.stockOnHand, 0)));
    setMessage(null);
  }, [preset]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy && !approvalOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, approvalOpen, onClose]);

  if (!context || !user) return null;

  // Inventory staff need a manager to sign off; asking up front saves a round trip. The main
  // process decides regardless and answers approvalRequired if this guess is wrong.
  const needsApproval = !canApprove(user.role, "stock_adjustment");
  const qty = product ? roundQtyForUom(Number(qtyAfter), product.uom) : Number(qtyAfter);
  const valid = product !== null && qtyAfter.trim() !== "" && Number.isFinite(qty) && qty >= 0;

  function handleSave(e: React.FormEvent): void {
    e.preventDefault();
    setMessage(null);
    if (!valid) return;
    if (needsApproval) {
      setApprovalError(null);
      setApprovalOpen(true);
      return;
    }
    void submit(null);
  }

  async function submit(approver: ApproverCredentials | null): Promise<void> {
    if (!context || !user || !product) return;
    setBusy(true);
    const result = await inventoryService.adjustStock({
      storeId: context.storeId,
      productId: product.productId,
      userId: user.id,
      qtyAfter: qty,
      reason,
      note: note.trim() || null,
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
      setMessage(result.error ?? "Could not adjust stock.");
      return;
    }

    setApprovalOpen(false);
    setMessage(`${product.name}: stock set to ${qty} ${product.uom}.`);
    setProduct(null);
    setQtyAfter("");
    setNote("");
    onSaved();
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card stock-adjust-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-stock-title"
        ref={cardRef}
      >
        <div className="popup-head">
          <h2 id="adjust-stock-title">Adjust Stock</h2>
          <button type="button" className="btn btn-ghost popup-close" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <form onSubmit={handleSave}>
          <ProductPicker
            storeId={context.storeId}
            value={product}
            onChange={(picked) => {
              setProduct(picked);
              setQtyAfter(picked ? String(Math.max(picked.stockOnHand, 0)) : "");
            }}
          />
          <div className="field">
            <label>Counted quantity on hand</label>
            <input
              required
              type="number"
              min={0}
              step={product && isFractionalUom(product.uom) ? 0.01 : 1}
              value={qtyAfter}
              onChange={(e) => setQtyAfter(e.target.value)}
              disabled={!product}
            />
          </div>
          <div className="field">
            <label>Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
              <option value="adjustment_correction">Count correction</option>
              <option value="manual_stock_in">Stock in</option>
              <option value="adjustment_damaged">Damaged</option>
              <option value="adjustment_missing">Missing</option>
              <option value="adjustment_expired">Expired</option>
            </select>
            {reason === "manual_stock_in" && (
              <p className="popup-hint">
                Bought new stock? Record it under Purchases → Direct receipt so its cost price is averaged in.
              </p>
            )}
          </div>
          <div className="field">
            <label>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <div className="modal-actions">
            {message && <span className="popup-status">{message}</span>}
            <button className="primary-btn" type="submit" disabled={!valid || busy}>
              {busy ? "Saving…" : needsApproval ? "Save (needs manager approval)" : "Save Adjustment"}
            </button>
          </div>
        </form>
      </div>

      {approvalOpen && product && (
        <ManagerApprovalDialog
          title="Manager approval"
          message={`A manager or owner must approve setting ${product.name} to ${qty} ${product.uom}.`}
          busy={busy}
          error={approvalError}
          onSubmit={(approver) => void submit(approver)}
          onCancel={() => {
            setApprovalOpen(false);
            setApprovalError(null);
          }}
        />
      )}
    </div>
  );
}
