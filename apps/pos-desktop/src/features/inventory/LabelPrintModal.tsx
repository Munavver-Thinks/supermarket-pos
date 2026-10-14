import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildLabelSheetHtml,
  DEFAULT_LABEL_LAYOUT,
  labelPageSizeMm,
  labelRupees,
  labelsPerSheet,
  type LabelLayout,
} from "@pos/business-logic";
import type { LabelDefaults } from "@pos/types";
import type { LabelSettings } from "@shared/ipc.js";

import { Icon } from "../../components/icons.js";
import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import { useSessionStore } from "../../store/sessionStore.js";

interface LabelPrintModalProps {
  productId: string;
  /** Set right after a repack, so the dates, MRP and copy count come from that run. */
  repackId?: string | null;
  onClose: () => void;
}

/** Rupees typed in a box to integer paise; null when it isn't a non-negative amount. */
function parseRupees(text: string): number | null {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** The preview shows one label at its real size, whatever the paper. */
function singleLabelLayout(layout: LabelLayout): LabelLayout {
  return { ...layout, paper: "roll", columns: 1, rows: 1, gapMm: 0, rowGapMm: 0, marginTopMm: 0, marginLeftMm: 0 };
}

/** A label's PKD/EXP only read to the month, but the dialog keeps full dates so they stay editable. */
export function LabelPrintModal({ productId, repackId = null, onClose }: LabelPrintModalProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const context = useSessionStore((s) => s.context);
  const [defaults, setDefaults] = useState<LabelDefaults | null>(null);
  const [settings, setSettings] = useState<LabelSettings | null>(null);
  const [copiesText, setCopiesText] = useState("1");
  const [packedOn, setPackedOn] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [mrpText, setMrpText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [startAtText, setStartAtText] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    if (!user || !context) return;
    let cancelled = false;
    window.api.labels
      .getDefaults(context.storeId, user.id, productId, repackId)
      .then((result) => {
        if (cancelled) return;
        if ("ok" in result) {
          setError(result.error);
          return;
        }
        setDefaults(result);
        setCopiesText(String(Math.max(1, result.suggestedCopies)));
        setPackedOn(result.packedOn ?? "");
        setExpiryDate(result.expiryDate ?? "");
        setMrpText(String(result.mrpPaise / 100));
        setPriceText(String(result.salePricePaise / 100));
      })
      .catch(() => !cancelled && setError("Could not load the label details."));
    window.api.labels
      .getSettings()
      .then((s) => !cancelled && setSettings(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, context, productId, repackId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    // Capture phase, so a modal underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const copies = Number(copiesText);
  const copiesValid = Number.isInteger(copies) && copies >= 1 && copies <= 500;
  const mrpPaise = parseRupees(mrpText);
  const salePricePaise = parseRupees(priceText);
  const priceTooHigh = mrpPaise !== null && salePricePaise !== null && mrpPaise > 0 && salePricePaise > mrpPaise;
  const datesOrdered = packedOn === "" || expiryDate === "" || expiryDate >= packedOn;

  const layout: LabelLayout = settings ? { ...settings } : DEFAULT_LABEL_LAYOUT;
  const isA4 = layout.paper === "a4";
  const perSheet = labelsPerSheet(layout);
  const startAt = Number(startAtText);
  const startAtValid = !isA4 || (Number.isInteger(startAt) && startAt >= 1 && startAt <= perSheet);
  const sheetsUsed = isA4 && copiesValid && startAtValid ? Math.ceil((startAt - 1 + copies) / perSheet) : 0;
  const lastPosition = isA4 && copiesValid && startAtValid ? ((startAt - 1 + copies - 1) % perSheet) + 1 : 0;

  const valid = copiesValid && startAtValid && mrpPaise !== null && salePricePaise !== null && !priceTooHigh && datesOrdered;

  const previewLayout = singleLabelLayout(layout);

  const previewHtml = useMemo(() => {
    if (!defaults) return "";
    try {
      return buildLabelSheetHtml(
        {
          storeName: defaults.storeName,
          productName: defaults.productName,
          barcode: defaults.barcode ?? "00000000",
          packedOn: packedOn || null,
          expiryDate: expiryDate || null,
          mrpPaise: mrpPaise ?? 0,
          salePricePaise: salePricePaise ?? 0,
        },
        1,
        singleLabelLayout(settings ?? DEFAULT_LABEL_LAYOUT),
      );
    } catch {
      return "";
    }
  }, [defaults, settings, packedOn, expiryDate, mrpPaise, salePricePaise]);

  const previewSize = labelPageSizeMm(previewLayout);

  async function handlePrint(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || !context || !valid || mrpPaise === null || salePricePaise === null) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.api.labels.print(
        {
          storeId: context.storeId,
          productId,
          repackId,
          copies,
          packedOn: packedOn || null,
          expiryDate: expiryDate || null,
          mrpPaise,
          salePricePaise,
          startAt: isA4 ? startAt : 1,
        },
        user.id,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(`Printed ${copies} ${copies === 1 ? "label" : "labels"}.`);
      // The next run continues where this one stopped on the sheet, if the sheet isn't used up.
      if (isA4) setStartAtText(String(lastPosition >= perSheet ? 1 : lastPosition + 1));
      if (result.barcodeAssigned) {
        setDefaults((d) => (d ? { ...d, barcode: result.barcode } : d));
      }
    } catch {
      setError("Could not reach the local service. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop modal-stacked">
      <div
        className="modal-card label-print-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-title"
        ref={cardRef}
      >
        <h2 id="label-title">Print labels{defaults ? ` — ${defaults.productName}` : ""}</h2>
        {!defaults && !error && <div className="text-muted">Loading…</div>}
        {defaults && (
          <form onSubmit={(e) => void handlePrint(e)}>
            <div className="label-print-body">
              <div className="label-print-fields">
                <div className="form-grid-2">
                  <div className="field">
                    <label htmlFor="label-copies">Copies</label>
                    <input
                      id="label-copies"
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={copiesText}
                      onChange={(e) => setCopiesText(e.target.value)}
                      disabled={busy}
                      autoFocus
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="label-mrp">MRP (₹)</label>
                    <input
                      id="label-mrp"
                      type="number"
                      min={0}
                      step="0.01"
                      value={mrpText}
                      onChange={(e) => setMrpText(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="label-price">Price (₹)</label>
                    <input
                      id="label-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={priceText}
                      onChange={(e) => setPriceText(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="label-packed">Packed on</label>
                    <input
                      id="label-packed"
                      type="date"
                      value={packedOn}
                      onChange={(e) => setPackedOn(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="label-expiry">Best before</label>
                    <input
                      id="label-expiry"
                      type="date"
                      value={expiryDate}
                      min={packedOn || undefined}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  {isA4 && (
                    <div className="field">
                      <label htmlFor="label-start">Start at label #</label>
                      <input
                        id="label-start"
                        type="number"
                        min={1}
                        max={perSheet}
                        step={1}
                        value={startAtText}
                        onChange={(e) => setStartAtText(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                  )}
                </div>
                {isA4 && sheetsUsed > 0 && (
                  <p className="popup-note">
                    {sheetsUsed === 1
                      ? `Uses positions ${startAt}–${lastPosition} of ${perSheet} on one A4 sheet.`
                      : `Starts at position ${startAt} and uses ${sheetsUsed} A4 sheets; the last one ends at position ${lastPosition}.`}{" "}
                    Positions count left to right, top row first.
                  </p>
                )}
                <p className="popup-note">
                  These changes are for this print only — they never change the product's prices.
                </p>

                <div className="popup-note label-print-info">
                  <div>
                    {defaults.barcode
                      ? `Barcode ${defaults.barcode}`
                      : "No barcode yet — one will be created and saved to this product when you print."}
                  </div>
                  {defaults.rackLocation && <div>Put on rack {defaults.rackLocation}</div>}
                  {mrpPaise !== null && salePricePaise !== null && (
                    <div>
                      MRP {labelRupees(mrpPaise)} · Price {labelRupees(salePricePaise)}
                    </div>
                  )}
                </div>
                {settings && settings.printerName === null && (
                  <div className="popup-callout info">
                    <Icon name="info" size={20} />
                    <span>No label printer set — you'll pick one in the print window.</span>
                  </div>
                )}
              </div>

              {previewHtml && (
                <div className="label-print-preview">
                  <div className="popup-kicker">Label preview</div>
                  <iframe
                    title="Label preview"
                    srcDoc={previewHtml}
                    sandbox=""
                    className="label-preview-frame"
                    style={{
                      width: `${previewSize.widthMm}mm`,
                      height: `${previewSize.heightMm}mm`,
                      background: "#fff",
                    }}
                  />
                </div>
              )}
            </div>

            {priceTooHigh && <div className="error-text">The price can't be more than the MRP.</div>}
            {!datesOrdered && <div className="error-text">Best before can't be earlier than the packed date.</div>}
            {!copiesValid && <div className="error-text">Copies must be a whole number from 1 to 500.</div>}
            {!startAtValid && (
              <div className="error-text">Start at must be a whole number from 1 to {perSheet}.</div>
            )}
            {error && <div className="error-text">{error}</div>}

            <div className="modal-actions">
              {message && <span className="popup-status">{message}</span>}
              <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>
                Close
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !valid}>
                <Icon name="printer" size={20} />
                {busy ? "Printing…" : `Print ${copiesValid ? copies : ""} ${copies === 1 ? "label" : "labels"}`}
              </button>
            </div>
          </form>
        )}
        {!defaults && error && (
          <>
            <div className="error-text">{error}</div>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
