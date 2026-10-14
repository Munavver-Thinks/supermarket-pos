import { useEffect, useRef, useState } from "react";
import { findMarginWarnings, isFractionalUom, marginConfirmText, roundQtyForUom } from "@pos/business-logic";
import type { Supplier } from "@pos/types";

import { productsService } from "@/services/productsService.js";
import { parseRupeesOrZero, parseRupeesStrict } from "@/utils/money.js";
import { useConfirm } from "@/context/ConfirmContext/index.js";
import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

interface AddProductModalProps {
  storeId: string;
  userId: string;
  suppliers: Supplier[];
  /** Called after a product is created, so the list and stock views behind can refresh. */
  onCreated: () => void;
  onClose: () => void;
}

const EMPTY_FORM = {
  name: "",
  nameTamil: "",
  shortCode: "",
  supplierId: "",
  barcode: "",
  alias: "",
  uom: "pcs",
  isWeighted: false,
  hsnCode: "",
  taxRatePercent: "5",
  reorderLevel: "0",
  mrp: "",
  salePrice: "",
  costPrice: "",
  wholesalePrice: "",
  rackLocation: "",
  shelfLifeDays: "",
};

/**
 * Stays open after a successful save, form reset and ready for the next one — adding a
 * catalog a handful of products at a time is the common case, not adding exactly one.
 */
export function AddProductModal({ storeId, userId, suppliers, onCreated, onClose }: AddProductModalProps): JSX.Element {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  useModalKeyboard(cardRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const costPricePaise = parseRupeesOrZero(form.costPrice);
  const salePricePaise = parseRupeesOrZero(form.salePrice);
  const wholesalePricePaise = form.wholesalePrice.trim() ? parseRupeesStrict(form.wholesalePrice) : null;
  const taxRatePercent = Number(form.taxRatePercent) || 0;
  const warnings = findMarginWarnings({
    costPricePaise,
    salePricePaise,
    wholesalePricePaise,
    taxRatePercent,
    isTaxInclusive: true,
  });

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (confirmingRef.current) return;
    setMessage(null);
    const shelfLifeText = form.shelfLifeDays.trim();
    const shelfLifeDays = shelfLifeText === "" ? null : Number(shelfLifeText);
    if (shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650)) {
      setMessage("Shelf life must be a whole number of days, from 1 to 3650.");
      return;
    }
    if (warnings.length > 0) {
      let ok = false;
      confirmingRef.current = true;
      try {
        ok = await confirm({
          title: "Price below cost",
          message: marginConfirmText(form.name, warnings),
          cancelLabel: "Go back",
          confirmLabel: "Save anyway",
        });
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    setBusy(true);

    const result = await productsService.create({
      storeId,
      userId,
      name: form.name,
      nameTamil: form.nameTamil || null,
      shortCode: form.shortCode || null,
      supplierId: form.supplierId || null,
      uom: form.uom,
      isWeighted: form.isWeighted,
      hsnCode: form.hsnCode.trim() || null,
      taxRatePercent: Number(form.taxRatePercent) || 0,
      barcodes: form.barcode ? [form.barcode] : [],
      aliases: form.alias ? [form.alias] : [],
      mrpPaise: parseRupeesStrict(form.mrp),
      salePricePaise: parseRupeesStrict(form.salePrice),
      costPricePaise: parseRupeesStrict(form.costPrice),
      wholesalePricePaise: form.wholesalePrice.trim() ? parseRupeesStrict(form.wholesalePrice) : null,
      isTaxInclusive: true,
      reorderLevel: Math.max(0, roundQtyForUom(Number(form.reorderLevel) || 0, form.uom)),
      rackLocation: form.rackLocation.trim() || null,
      shelfLifeDays,
    });

    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not create product.");
      return;
    }
    setMessage(`${form.name} added.`);
    setForm(EMPTY_FORM);
    onCreated();
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card add-product-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-product-title"
        ref={cardRef}
      >
        <div className="popup-head">
          <h2 id="add-product-title">Add Product</h2>
          <button type="button" className="btn btn-ghost popup-close" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-grid-3">
            <div className="field">
              <label>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </div>
            <div className="field">
              <label>Name (Tamil)</label>
              <input value={form.nameTamil} onChange={(e) => setForm({ ...form, nameTamil: e.target.value })} />
            </div>
            <div className="field">
              <label>Short code / SKU</label>
              <input value={form.shortCode} onChange={(e) => setForm({ ...form, shortCode: e.target.value })} />
            </div>
            <div className="field">
              <label>Barcode</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </div>
            <div className="field">
              <label>Supplier</label>
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">— none —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Search alias (e.g. Tanglish name)</label>
              <input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />
            </div>
          </div>
          <div className="form-grid-4">
            <div className="field">
              <label>Unit</label>
              <select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })}>
                <option value="pcs">pcs</option>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">l</option>
                <option value="ml">ml</option>
              </select>
            </div>
            <div className="field">
              <label>HSN code</label>
              <input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
            </div>
            <div className="field">
              <label>Tax rate (%)</label>
              <input
                type="number"
                value={form.taxRatePercent}
                onChange={(e) => setForm({ ...form, taxRatePercent: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Reorder level</label>
              <input
                type="number"
                min={0}
                step={isFractionalUom(form.uom) ? 0.01 : 1}
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
              />
            </div>
          </div>
          <div className="form-grid-4">
            <div className="field">
              <label>MRP (₹)</label>
              <input required type="number" step="0.01" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
            </div>
            <div className="field">
              <label>Sale price (₹)</label>
              <input
                required
                type="number"
                step="0.01"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Cost price (₹, ex-GST)</label>
              <input
                required
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Wholesale price (₹)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Optional"
                value={form.wholesalePrice}
                onChange={(e) => setForm({ ...form, wholesalePrice: e.target.value })}
              />
            </div>
          </div>
          {warnings.map((w) => (
            <div key={w.kind} className="error-text">
              {w.message}
            </div>
          ))}
          <div className="form-grid-3">
            <div className="field">
              <label>Rack / shelf</label>
              <input
                maxLength={40}
                placeholder="e.g. B-3"
                value={form.rackLocation}
                onChange={(e) => setForm({ ...form, rackLocation: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Shelf life (days)</label>
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                value={form.shelfLifeDays}
                onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })}
              />
              <div className="popup-hint">
                For packs you make in-store — sets the default best-before when repacking.
              </div>
            </div>
            <label className="popup-check beside-field">
              <input
                type="checkbox"
                checked={form.isWeighted}
                onChange={(e) => setForm({ ...form, isWeighted: e.target.checked })}
              />
              Sold by weight
            </label>
          </div>
          <div className="modal-actions">
            {message && <span className="popup-status">{message}</span>}
            <button className="primary-btn" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
