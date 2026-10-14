import { useEffect, useRef, useState } from "react";
import { defaultBestBefore, localDateIso } from "@pos/business-logic";
import type { ProductPackRow } from "@pos/types";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { LabelPrintModal } from "./LabelPrintModal.js";

interface RepackModalProps {
  storeId: string;
  parentProductId: string;
  parentName: string;
  parentQtyOnHand: number;
  parentUom: string;
  child: ProductPackRow;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Converts stock of a bulk product into stock of one pack-size child — "make 20 packs of
 * Sugar 1kg from Sugar 50kg Bag". The server is the real guard (it refuses rather than
 * reaching into expired stock); this just previews how much of the parent the request will
 * use so a mistake is obvious before submitting, not after.
 */
export function RepackModal({
  storeId,
  parentProductId,
  parentName,
  parentQtyOnHand,
  parentUom,
  child,
  onDone,
  onCancel,
}: RepackModalProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const today = localDateIso();
  const [childQtyText, setChildQtyText] = useState("");
  const [packedOn, setPackedOn] = useState(today);
  const [expiryDate, setExpiryDate] = useState(defaultBestBefore(today, child.shelfLifeDays) ?? "");
  const [expiryEdited, setExpiryEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ repackId: string; batchNo: string; qty: number } | null>(null);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy && !printing) {
        e.preventDefault();
        e.stopPropagation();
        // Once the packs exist, closing must still refresh the screens behind.
        if (made) onDone();
        else onCancel();
      }
    }
    // Capture phase, so the product-edit modal underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, printing, made, onDone, onCancel]);

  const childQty = Number(childQtyText);
  const parentNeeded = Number.isFinite(childQty) && childQty > 0 ? childQty * child.packQty : 0;
  const datesValid = packedOn !== "" && packedOn <= today && (expiryDate === "" || expiryDate >= packedOn);
  const valid = parentNeeded > 0 && parentNeeded <= parentQtyOnHand + 1e-9 && datesValid;

  function changePackedOn(value: string): void {
    setPackedOn(value);
    if (!expiryEdited && value) setExpiryDate(defaultBestBefore(value, child.shelfLifeDays) ?? "");
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.inventory.repack(
        { storeId, parentProductId, childProductId: child.id, childQty, packedOn, expiryDate: expiryDate || null },
        user.id,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMade({ repackId: result.repackId, batchNo: result.batchNo, qty: childQty });
    } catch {
      setError("Could not reach the local service. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-backdrop modal-stacked">
        <div
          className="modal-card repack-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="repack-title"
          ref={cardRef}
        >
        {made ? (
          <>
            <h2 id="repack-title">Made {child.name}</h2>
            <p className="popup-text">
              Made {made.qty} × {child.name} — batch {made.batchNo}.
            </p>
            {child.rackLocation && <p className="popup-text">Put on rack {child.rackLocation}.</p>}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={onDone}>
                Done
              </button>
              <button type="button" className="primary-btn" onClick={() => setPrinting(true)}>
                Print {made.qty} {made.qty === 1 ? "label" : "labels"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <h2 id="repack-title">Make {child.name}</h2>
            <p className="popup-note">
              Converts stock from {parentName} ({parentQtyOnHand} {parentUom} on hand) into {child.name}.
            </p>
            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="repack-qty">How many {child.name} to make</label>
                <input
                  id="repack-qty"
                  ref={inputRef}
                  type="number"
                  min={0}
                  step={1}
                  value={childQtyText}
                  onChange={(e) => setChildQtyText(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="repack-uses">
                {parentNeeded > 0 && (
                  <p className="popup-text">
                    Uses {parentNeeded} {parentUom} of {parentName}
                    {parentNeeded > parentQtyOnHand && (
                      <span className="error-text">
                        {" "}
                        — more than the {parentQtyOnHand} {parentUom} on hand.
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="repack-packed">Packed on</label>
                <input
                  id="repack-packed"
                  type="date"
                  max={today}
                  value={packedOn}
                  onChange={(e) => changePackedOn(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="field">
                <label htmlFor="repack-expiry">Best before</label>
                <input
                  id="repack-expiry"
                  type="date"
                  min={packedOn || undefined}
                  value={expiryDate}
                  onChange={(e) => {
                    setExpiryDate(e.target.value);
                    setExpiryEdited(true);
                  }}
                  disabled={busy}
                />
              </div>
            </div>
            <p className="popup-note">If the bulk stock expires sooner, its date is used.</p>
            {!datesValid && packedOn !== "" && (
              <div className="error-text">
                {packedOn > today
                  ? "Packed on can't be a future date."
                  : "Best before can't be earlier than the packed date."}
              </div>
            )}
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !valid}>
                {busy ? "Making…" : "Make"}
              </button>
            </div>
          </form>
        )}
        </div>
      </div>
      {printing && made && (
        <LabelPrintModal productId={child.id} repackId={made.repackId} onClose={() => setPrinting(false)} />
      )}
    </>
  );
}
