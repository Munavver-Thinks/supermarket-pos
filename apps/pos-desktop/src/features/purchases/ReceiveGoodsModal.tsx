import { useEffect, useRef, useState } from "react";
import {
  computePurchaseTotals,
  findMarginWarnings,
  findMrpWarnings,
  formatIndianCurrency,
  isFractionalUom,
  localDateIso,
  purchaseMarginConfirmText,
  purchaseMrpConfirmText,
  roundQtyForUom,
  weightedAverageCost,
} from "@pos/business-logic";
import type { PurchaseOrderDetail, PurchasePriceSnapshot } from "@pos/types";

import { isDenied } from "@/services/ipcResult.js";
import { parsePositiveRupeesOrNull, parseRupeesStrict } from "@/utils/money.js";
import { useConfirm } from "@/context/ConfirmContext/index.js";
import { afterFirstLine } from "@/utils/text.js";
import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

import { useSessionStore } from "../../store/sessionStore.js";

import { purchaseOrdersService } from "./services/purchaseOrdersService.js";
import { purchasesService } from "./services/purchasesService.js";

interface ReceiveGoodsModalProps {
  detail: PurchaseOrderDetail;
  onClose: () => void;
  onReceived: (message: string) => void;
}

interface ReceiveLine {
  poItemId: string;
  productId: string;
  name: string;
  uom: string;
  remaining: number;
  qty: string;
  costRupees: string;
  batchNo: string;
  expiryDate: string;
  /** Rupees as typed; blank/zero means "no change" to the product's recorded MRP. */
  mrpRupees: string;
}

/**
 * Books goods that arrived against an order. Quantities start at what is still due and can
 * be lowered for a part delivery; receiving more than is due isn't allowed. The retry key is
 * made once when the window opens, so a double click or a resend records the delivery once.
 */
export function ReceiveGoodsModal({ detail, onClose, onReceived }: ReceiveGoodsModalProps): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const clientTxnId = useRef(crypto.randomUUID());
  const [snapshots, setSnapshots] = useState<Record<string, PurchasePriceSnapshot>>({});
  const [lines, setLines] = useState<ReceiveLine[]>(() =>
    detail.items
      .filter((item) => item.qtyRemaining > 0)
      .map((item) => ({
        poItemId: item.id,
        productId: item.productId,
        name: item.productName,
        uom: item.uom,
        remaining: item.qtyRemaining,
        qty: String(item.qtyRemaining),
        costRupees: (item.costPricePaise / 100).toFixed(2),
        batchNo: "",
        expiryDate: "",
        mrpRupees: "",
      })),
  );
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => localDateIso());
  const [notes, setNotes] = useState("");
  const [updateCostPrice, setUpdateCostPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  useModalKeyboard(formRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (!context || !user) return;
    const productIds = [...new Set(detail.items.map((i) => i.productId))];
    if (productIds.length === 0) return;
    purchasesService
      .getPriceSnapshots(context.storeId, productIds, user.id)
      .then((result) => {
        if (isDenied(result)) return;
        setSnapshots(result);
      })
      .catch(() => {
        // No warning tag or averaged-cost preview if the snapshot can't be fetched.
      });
  }, [context, user, detail.items]);

  const taxById = new Map(detail.items.map((i) => [i.id, i]));
  const chosen = lines.filter((l) => Number(l.qty) > 0);
  // Preview only; the main process works the money out again from the order's tax details.
  const { lines: computedLines, totals } = computePurchaseTotals(
    chosen.map((l) => ({
      productId: l.productId,
      qty: roundQtyForUom(Number(l.qty), l.uom),
      costPricePaise: parseRupeesStrict(l.costRupees),
      taxRatePercent: taxById.get(l.poItemId)?.taxRatePercent ?? 0,
      isTaxInclusive: taxById.get(l.poItemId)?.isTaxInclusive ?? false,
    })),
  );

  // Per chosen line: the margin warning and, when "update cost" is on, a preview of what the
  // averaged cost would become.
  const chosenInfo = chosen.map((l, index) => {
    const snapshot = snapshots[l.productId];
    const computed = computedLines[index];
    const qty = roundQtyForUom(Number(l.qty), l.uom);
    const costExTaxPaise = computed && qty > 0 ? Math.round(computed.taxablePaise / qty) : 0;
    const warnings = snapshot
      ? findMarginWarnings({
          costPricePaise: costExTaxPaise,
          salePricePaise: snapshot.salePricePaise,
          wholesalePricePaise: snapshot.wholesalePricePaise,
          taxRatePercent: snapshot.taxRatePercent,
          isTaxInclusive: snapshot.isTaxInclusive,
        })
      : [];
    const averagedCostPreviewPaise =
      updateCostPrice && snapshot && computed
        ? weightedAverageCost({
            qtyOnHandBefore: snapshot.qtyOnHand,
            currentCostPaise: snapshot.costPricePaise,
            qtyReceived: qty,
            receivedTaxablePaise: computed.taxablePaise,
          })
        : null;
    const mrpPaise = parsePositiveRupeesOrNull(l.mrpRupees);
    const mrpWarnings =
      mrpPaise !== null && snapshot
        ? findMrpWarnings({
            mrpPaise,
            salePricePaise: snapshot.salePricePaise,
            wholesalePricePaise: snapshot.wholesalePricePaise,
          })
        : [];
    return {
      costExTaxPaise,
      warnings,
      averagedCostPreviewPaise,
      salePricePaise: snapshot?.salePricePaise ?? 0,
      mrpPaise,
      mrpWarnings,
    };
  });
  const infoByPoItemId = new Map(chosen.map((l, index) => [l.poItemId, chosenInfo[index]]));

  function update(poItemId: string, patch: Partial<ReceiveLine>): void {
    setLines((prev) => prev.map((l) => (l.poItemId === poItemId ? { ...l, ...patch } : l)));
  }

  async function handleReceive(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || busy || confirmingRef.current) return;
    setError(null);
    if (!invoiceNo.trim()) {
      setError("Enter the supplier's invoice number.");
      return;
    }
    if (chosen.length === 0) {
      setError("Enter at least one quantity received.");
      return;
    }
    const over = chosen.find((l) => roundQtyForUom(Number(l.qty), l.uom) - l.remaining > 1e-9);
    if (over) {
      setError(`Only ${over.remaining} ${over.uom} of ${over.name} are still due.`);
      return;
    }

    const warnRows = chosen
      .map((l) => ({ line: l, info: infoByPoItemId.get(l.poItemId) }))
      .filter(({ info }) => info?.warnings.some((w) => w.kind === "sale"))
      .map(({ line, info }) => ({
        name: line.name,
        costPricePaise: info?.costExTaxPaise ?? 0,
        salePricePaise: info?.salePricePaise ?? 0,
      }));
    confirmingRef.current = true;
    try {
      if (
        warnRows.length > 0 &&
        !(await confirm({
          title: "These items cost as much as or more than they sell for",
          message: afterFirstLine(purchaseMarginConfirmText(warnRows)),
          cancelLabel: "Go back",
          confirmLabel: "Receive anyway",
          tone: "primary",
        }))
      ) {
        return;
      }
    } finally {
      confirmingRef.current = false;
    }

    const mrpWarnRows = chosen
      .map((l) => ({ line: l, info: infoByPoItemId.get(l.poItemId) }))
      .filter(({ info }) => info?.mrpWarnings.some((w) => w.kind === "sale"))
      .map(({ line, info }) => ({
        name: line.name,
        mrpPaise: info?.mrpPaise ?? 0,
        salePricePaise: info?.salePricePaise ?? 0,
      }));
    confirmingRef.current = true;
    try {
      if (
        mrpWarnRows.length > 0 &&
        !(await confirm({
          title: "These items' new MRP is below what they sell for",
          message: afterFirstLine(purchaseMrpConfirmText(mrpWarnRows)),
          cancelLabel: "Go back",
          confirmLabel: "Receive anyway",
          tone: "primary",
        }))
      ) {
        return;
      }
    } finally {
      confirmingRef.current = false;
    }

    setBusy(true);
    const result = await purchaseOrdersService.receive({
      poId: detail.order.id,
      actingUserId: user.id,
      clientTxnId: clientTxnId.current,
      invoiceNo: invoiceNo.trim(),
      invoiceDate,
      notes: notes.trim() || null,
      updateCostPrice,
      lines: chosen.map((l) => ({
        poItemId: l.poItemId,
        qty: roundQtyForUom(Number(l.qty), l.uom),
        costPricePaise: parseRupeesStrict(l.costRupees),
        batchNo: l.batchNo.trim() || null,
        expiryDate: l.expiryDate || null,
        mrpPaise: parsePositiveRupeesOrNull(l.mrpRupees),
      })),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not record the delivery.");
      return;
    }
    onReceived(
      result.order?.status === "received"
        ? `${detail.order.poNo} fully received — stock added.`
        : `Delivery recorded against ${detail.order.poNo} — stock added. The rest is still due.`,
    );
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card receive-goods-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receive-goods-title"
        onSubmit={handleReceive}
        ref={formRef}
      >
        <h2 id="receive-goods-title">Receive goods · {detail.order.poNo}</h2>
        <p className="popup-note">
          {detail.supplierName}. Set a quantity to 0 for anything that didn&rsquo;t arrive. Batch, expiry and MRP are
          optional — leave MRP blank unless the printed price differs from what&rsquo;s already on file.
        </p>

        <div className="form-grid-3">
          <div className="field">
            <label>Supplier invoice no.</label>
            <input required value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div className="field">
            <label>Invoice date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="table-scroll">
          <table className="table modal-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="r">Due</th>
                <th>Received</th>
                <th className="r">Cost / unit (₹)</th>
                <th className="r">MRP on pack (₹)</th>
                <th>Batch no.</th>
                <th>Expiry date</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.poItemId}>
                  <td>{l.name}</td>
                  <td className="r">
                    {l.remaining} {l.uom}
                  </td>
                  <td>
                    <input
                      className="receive-qty"
                      type="number"
                      min={0}
                      max={l.remaining}
                      step={isFractionalUom(l.uom) ? 0.01 : 1}
                      value={l.qty}
                      onChange={(e) => update(l.poItemId, { qty: e.target.value })}
                    />
                  </td>
                  <td className="r">
                    <input
                      className="receive-money"
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.costRupees}
                      onChange={(e) => update(l.poItemId, { costRupees: e.target.value })}
                    />
                    {infoByPoItemId.get(l.poItemId)?.averagedCostPreviewPaise != null && (
                      <div className="popup-hint">
                        New average: {formatIndianCurrency(infoByPoItemId.get(l.poItemId)!.averagedCostPreviewPaise!)}
                      </div>
                    )}
                    {infoByPoItemId.get(l.poItemId)?.warnings.map((w) => (
                      <div key={w.kind} className="tag tag-warn">
                        {w.message}
                      </div>
                    ))}
                  </td>
                  <td className="r">
                    <input
                      className="receive-money"
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.mrpRupees}
                      onChange={(e) => update(l.poItemId, { mrpRupees: e.target.value })}
                      placeholder={
                        snapshots[l.productId]?.mrpPaise
                          ? formatIndianCurrency(snapshots[l.productId]!.mrpPaise).replace("₹", "")
                          : "—"
                      }
                    />
                    {infoByPoItemId.get(l.poItemId)?.mrpWarnings.map((w) => (
                      <div key={w.kind} className="tag tag-warn">
                        {w.message}
                      </div>
                    ))}
                  </td>
                  <td>
                    <input
                      className="receive-batch"
                      value={l.batchNo}
                      onChange={(e) => update(l.poItemId, { batchNo: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={l.expiryDate}
                      onChange={(e) => update(l.poItemId, { expiryDate: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="receive-summary">
          <label className="popup-check">
            <input type="checkbox" checked={updateCostPrice} onChange={(e) => setUpdateCostPrice(e.target.checked)} />
            Average into each product&apos;s cost price
          </label>

          <div className="receive-totals">
            <div className="row">
              <span>Taxable</span>
              <span>{formatIndianCurrency(totals.subtotalPaise)}</span>
            </div>
            <div className="row">
              <span>GST</span>
              <span>{formatIndianCurrency(totals.taxPaise)}</span>
            </div>
            <div className="row net">
              <span>Invoice total</span>
              <span>{formatIndianCurrency(totals.totalPaise)}</span>
            </div>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={busy || chosen.length === 0}>
            {busy ? "Recording…" : "Receive & add stock"}
          </button>
        </div>
      </form>
    </div>
  );
}
