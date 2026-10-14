import { useEffect, useRef, useState } from "react";
import { formatIndianCurrency, isFractionalUom, roundQtyForUom } from "@pos/business-logic";
import type { ProductSearchResult } from "@pos/types";

import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

interface QuantityModalProps {
  product: ProductSearchResult;
  /**
   * A quantity/weight the cashier already typed before picking this product (e.g. "2 milk",
   * "ash gourd 1.85kg"), pre-filled so confirming is a single Enter. For a weighed product
   * with nothing explicit typed, this is null and the field starts blank instead of silently
   * defaulting to 1 of a weighed unit — almost never the quantity actually meant. A non-weighed
   * product always gets a number here (1, if nothing was typed), since that default is usually
   * right and the field only needs confirming, not filling in.
   */
  initialQty: number | null;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}

/** Weighed uom → what to call the number being entered. Anything else falls back to "Quantity". */
const QTY_LABEL: Record<string, string> = {
  kg: "Weight (kg)",
  g: "Weight (g)",
  l: "Volume (l)",
  ml: "Volume (ml)",
};

/**
 * Stands between picking a product — click or Enter, weighed or not — and adding it to the
 * bill; see SearchPanel's `pick()`. Per the documented weight flow (Tomato, 1.85 KG, ₹60/KG →
 * ₹111): a weighed item's quantity comes off a scale, not a default, so it's asked for
 * explicitly every time rather than silently assuming 1kg. A non-weighed product goes through
 * the same popup for a consistent "pick, then confirm" flow, but pre-filled, so it costs one
 * Enter, not a decision.
 */
export function QuantityModal({ product, initialQty, onConfirm, onCancel }: QuantityModalProps): JSX.Element {
  const [text, setText] = useState(initialQty !== null ? String(initialQty) : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    // Capture phase, so the billing screen underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const qty = roundQtyForUom(Number(text), product.uom);
  const valid = text.trim().length > 0 && Number.isFinite(qty) && qty > 0;

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (valid) onConfirm(qty);
  }

  const label = QTY_LABEL[product.uom] ?? `Quantity (${product.uom})`;

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qty-modal-title"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <h2 id="qty-modal-title">{product.name}</h2>
        <p className="text-muted">
          {formatIndianCurrency(product.salePricePaise)} / {product.uom}
        </p>
        <div className="field">
          <label htmlFor="qty-modal-input">{label}</label>
          <input
            id="qty-modal-input"
            className="qty-input"
            ref={inputRef}
            type="number"
            inputMode={isFractionalUom(product.uom) ? "decimal" : "numeric"}
            min={0}
            step={isFractionalUom(product.uom) ? 0.01 : 1}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {valid && (
          <p className="qty-summary">
            {qty} {product.uom} × {formatIndianCurrency(product.salePricePaise)} ={" "}
            <strong>{formatIndianCurrency(Math.round(qty * product.salePricePaise))}</strong>
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={!valid}>
            Add to bill
          </button>
        </div>
      </form>
    </div>
  );
}
