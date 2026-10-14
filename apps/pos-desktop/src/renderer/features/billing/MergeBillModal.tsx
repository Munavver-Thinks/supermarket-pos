import { useEffect, useRef, useState } from "react";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import type { BillTab } from "../../store/cartStore.js";

interface MergeBillModalProps {
  bills: BillTab[];
  sourceIndex: number;
  error: string | null;
  onMerge: (targetIndex: number) => void;
  onCancel: () => void;
}

/** Picks which open bill the current one is folded into. The current bill's tab then closes. */
export function MergeBillModal({ bills, sourceIndex, error, onMerge, onCancel }: MergeBillModalProps): JSX.Element {
  const targets = bills.map((bill, index) => ({ bill, index })).filter(({ index }) => index !== sourceIndex);
  const [targetIndex, setTargetIndex] = useState<number | null>(targets[0]?.index ?? null);
  const source = bills[sourceIndex];
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

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

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card merge-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-bill-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (targetIndex !== null) onMerge(targetIndex);
        }}
        ref={formRef}
      >
        <h2 id="merge-bill-title">Merge {source?.label ?? "bill"} into…</h2>
        <p className="text-muted">
          Its items are added to the bill you choose, and its tab closes. Items at the same price and discount are
          combined into one line.
        </p>
        <div role="radiogroup" className="merge-targets">
          {targets.map(({ bill, index }, i) => (
            <label
              key={bill.cart.clientTxnId}
              className={targetIndex === index ? "merge-target selected" : "merge-target"}
            >
              <input
                type="radio"
                name="merge-target"
                checked={targetIndex === index}
                onChange={() => setTargetIndex(index)}
                autoFocus={i === 0}
              />
              <span className="merge-target-text">
                {bill.label} <span className="text-muted">({bill.cart.lines.length} items)</span>
              </span>
            </label>
          ))}
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={targetIndex === null}>
            Merge
          </button>
        </div>
      </form>
    </div>
  );
}
