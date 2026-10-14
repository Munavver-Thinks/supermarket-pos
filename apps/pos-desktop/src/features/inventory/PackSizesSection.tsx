import { useCallback, useEffect, useState } from "react";
import {
  formatIndianCurrency,
  formatStockQty,
  isFractionalUom,
  labelMonth,
  roundQtyForUom,
  sumPackStock,
  totalStockQty,
} from "@pos/business-logic";
import type { ProductForEdit, ProductPackRow, RepackHistoryEntry } from "@pos/types";

import { inventoryService } from "@/services/inventoryService.js";
import { productsService } from "@/services/productsService.js";

import { useSessionStore } from "../../store/sessionStore.js";

import { LabelPrintModal } from "./LabelPrintModal.js";
import { RepackModal } from "./RepackModal.js";

interface PackSizesSectionProps {
  parent: ProductForEdit;
  /** Called after a pack size is added or repacked, so the screen behind can refresh too
   * (the parent's own stock changes on a repack). */
  onChanged: () => void;
}

/**
 * Smaller retail packs made from a bulk product — "Sugar 1kg" and "Sugar 500g" from a 50kg
 * bag. Shown only on the bulk product's own edit screen; a pack size doesn't get this section
 * itself (one level only — see productPacks.ts).
 */
export function PackSizesSection({ parent, onChanged }: PackSizesSectionProps): JSX.Element | null {
  const user = useSessionStore((s) => s.user);
  const [children, setChildren] = useState<ProductPackRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [packQtyText, setPackQtyText] = useState("");
  const [barcode, setBarcode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [repacking, setRepacking] = useState<ProductPackRow | null>(null);
  const [history, setHistory] = useState<RepackHistoryEntry[]>([]);
  const [labelFor, setLabelFor] = useState<{ productId: string; repackId: string | null } | null>(null);

  const refresh = useCallback(() => {
    if (!user) return;
    productsService
      .listChildren(parent.storeId, user.id, parent.id)
      .then(setChildren)
      .catch(() => setChildren([]));
    inventoryService
      .repackHistory(parent.storeId, user.id, parent.id)
      .then((result) => setHistory(Array.isArray(result) ? result : []))
      .catch(() => setHistory([]));
  }, [parent.storeId, parent.id, user]);

  useEffect(refresh, [refresh]);

  async function handleAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user) return;
    const packQty = roundQtyForUom(Number(packQtyText), parent.uom);
    if (name.trim().length === 0 || !Number.isFinite(packQty) || packQty <= 0) {
      setMessage("Enter a name and a pack size greater than 0.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await productsService.createChild(parent.storeId, user.id, {
      parentProductId: parent.id,
      name: name.trim(),
      nameTamil: null,
      packQty,
      barcodes: barcode.trim() ? [barcode.trim()] : [],
      aliases: [],
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not add that pack size.");
      return;
    }
    setName("");
    setPackQtyText("");
    setBarcode("");
    setAdding(false);
    refresh();
    onChanged();
  }

  // A pack size doesn't get its own pack sizes — one level only.
  if (parent.parentProductId) return null;

  const pack = children ? sumPackStock(children) : 0;
  const total = totalStockQty(parent.qtyOnHand, pack);

  return (
    <div className="popup-section">
      <div className="popup-section-head">
        <h4>Pack sizes</h4>
      </div>
      <p className="popup-note">
        Smaller retail packs made from this product, e.g. "1kg" and "500g" from a 50kg bag. Each has its own stock —
        making one moves stock from here into it.
      </p>

      {children === null && <div className="text-muted">Loading…</div>}

      {children && children.length > 0 && (
        <div className="pack-total">
          <strong>
            Total on hand: {formatStockQty(total)} {parent.uom}
          </strong>
          <span className="text-muted">
            {" "}
            — {formatStockQty(parent.qtyOnHand)} {parent.uom} loose + {formatStockQty(pack)} {parent.uom} in packs
          </span>
        </div>
      )}

      {children && children.length > 0 && (
        <table className="table modal-table">
          <thead>
            <tr>
              <th>Pack</th>
              <th>Size</th>
              <th className="r">Price</th>
              <th className="r">Stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {children.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {!c.isActive && <span className="text-muted"> (inactive)</span>}
                </td>
                <td>
                  {c.packQty} {parent.uom}
                  {c.priceLinkedToParent && <span className="text-muted"> · linked</span>}
                </td>
                <td className="r">{formatIndianCurrency(c.salePricePaise)}</td>
                <td className="r">{c.qtyOnHand}</td>
                <td className="r">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setLabelFor({ productId: c.id, repackId: null })}
                  >
                    Labels
                  </button>{" "}
                  <button type="button" className="btn btn-ghost" onClick={() => setRepacking(c)}>
                    Repack
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {history.length > 0 && (
        <div className="popup-stack">
          <h4 className="popup-kicker">Repack history</h4>
          <ul className="repack-history">
            {history.map((h) => (
              <li key={h.repackId}>
                <strong>{h.batchNo}</strong> · {h.packedOn} · {formatStockQty(h.childQty)} × {h.childName} · used{" "}
                {formatStockQty(h.parentQtyUsed)} {h.parentUom}
                <div className="text-muted">
                  PKD {labelMonth(h.packedOn)} · EXP {h.expiryDate ? labelMonth(h.expiryDate) : "—"} · by {h.userName} ·{" "}
                  {h.labelsPrinted > 0 ? (
                    `${h.labelsPrinted} ${h.labelsPrinted === 1 ? "label" : "labels"} printed`
                  ) : (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setLabelFor({ productId: h.childProductId, repackId: h.repackId })}
                    >
                      Print labels
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!adding && (
        <button type="button" className="secondary-btn popup-btn-sm" onClick={() => setAdding(true)}>
          + Add pack size
        </button>
      )}

      {adding && (
        <form onSubmit={(e) => void handleAdd(e)} className="form-grid-3 pack-add-form">
          <div className="field">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${parent.name.split(" ")[0]} 1kg`}
              autoFocus
              disabled={busy}
            />
          </div>
          <div className="field">
            <label>Size ({parent.uom} each)</label>
            <input
              type="number"
              min={0}
              step={isFractionalUom(parent.uom) ? 0.01 : 1}
              value={packQtyText}
              onChange={(e) => setPackQtyText(e.target.value)}
              placeholder="1"
              disabled={busy}
            />
          </div>
          <div className="field">
            <label>Barcode (optional)</label>
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={busy} />
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}
      {message && <div className="error-text">{message}</div>}

      {labelFor && (
        <LabelPrintModal
          productId={labelFor.productId}
          repackId={labelFor.repackId}
          onClose={() => {
            setLabelFor(null);
            refresh();
          }}
        />
      )}

      {repacking && (
        <RepackModal
          storeId={parent.storeId}
          parentProductId={parent.id}
          parentName={parent.name}
          parentQtyOnHand={parent.qtyOnHand}
          parentUom={parent.uom}
          child={repacking}
          onDone={() => {
            setRepacking(null);
            refresh();
            onChanged();
          }}
          onCancel={() => setRepacking(null)}
        />
      )}
    </div>
  );
}
