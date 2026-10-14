import { useEffect, useRef, useState } from "react";
import { isFractionalUom, roundQtyForUom } from "@pos/business-logic";
import type { Cart } from "@pos/types";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";

interface SplitBillModalProps {
  label: string;
  cart: Cart;
  error: string | null;
  onSplit: (take: Record<string, number>) => void;
  onCancel: () => void;
}

/** Chooses how much of each line moves to a new bill. */
export function SplitBillModal({ label, cart, error, onSplit, onCancel }: SplitBillModalProps): JSX.Element {
  const [qtys, setQtys] = useState<Record<string, string>>({});
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

  const uomByLine = new Map(cart.lines.map((line) => [line.lineId, line.uom]));
  const take: Record<string, number> = {};
  for (const [lineId, text] of Object.entries(qtys)) {
    const qty = Number(text);
    if (Number.isFinite(qty) && qty > 0) take[lineId] = roundQtyForUom(qty, uomByLine.get(lineId) ?? "pcs");
  }
  const anyChosen = Object.keys(take).length > 0;

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card split-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="split-bill-title"
        onSubmit={(e) => {
          e.preventDefault();
          onSplit(take);
        }}
        ref={formRef}
      >
        <h2 id="split-bill-title">Split {label}</h2>
        <p className="text-muted">
          Enter how much of each item moves to a new bill. The new bill keeps the customer; a discount on the whole bill
          stays on this one.
        </p>
        <table className="table split-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">On bill</th>
              <th>Move</th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line, i) => (
              <tr key={line.lineId}>
                <td>{line.name}</td>
                <td className="num">
                  {line.qty} {line.uom}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={line.qty}
                    step={isFractionalUom(line.uom) ? 0.01 : 1}
                    placeholder="0"
                    aria-label={`Quantity of ${line.name} to move`}
                    value={qtys[line.lineId] ?? ""}
                    onChange={(e) => setQtys((prev) => ({ ...prev, [line.lineId]: e.target.value }))}
                    className="split-qty-input"
                    autoFocus={i === 0}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={!anyChosen}>
            Move to a new bill
          </button>
        </div>
      </form>
    </div>
  );
}
