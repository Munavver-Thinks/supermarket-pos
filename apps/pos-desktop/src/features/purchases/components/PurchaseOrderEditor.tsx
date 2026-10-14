import { useCallback, useEffect, useRef, useState } from "react";
import {
  canPlacePurchaseOrder,
  computePurchaseTotals,
  findMarginWarnings,
  formatIndianCurrency,
  isFractionalUom,
  roundQtyForUom,
} from "@pos/business-logic";
import type { ProductSearchResult, PurchaseOrderDetail, PurchasePriceSnapshot, Supplier } from "@pos/types";
import { rupeesToPaise } from "@pos/business-logic";

import { productsService } from "@/services/productsService.js";
import { isDenied } from "@/services/ipcResult.js";
import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { useSessionStore } from "@/store/sessionStore.js";

import { purchaseOrdersService } from "../services/purchaseOrdersService.js";
import { purchasesService } from "../services/purchasesService.js";
import { PO_STATUS_LABEL, PO_STATUS_PILL } from "../constants.js";

import { ReceiveGoodsModal } from "./ReceiveGoodsModal.js";

interface EditorLine {
  lineId: string;
  productId: string;
  name: string;
  uom: string;
  qty: number;
  costRupees: number;
  taxRatePercent: number;
  /** This product's current price + stock — null while loading or if it couldn't be fetched.
   * Seeds the cost box and drives the margin warning tag; a purchase order moves no stock or
   * cost itself, so there's no confirm-on-save here, unlike the receipt screens. */
  snapshot: PurchasePriceSnapshot | null;
}

interface PurchaseOrderEditorProps {
  /** null starts a new draft. */
  poId: string | null;
  suppliers: Supplier[];
  onBack: () => void;
  /** Called with the order id after anything is saved, so the list can refresh. */
  onChanged: (poId: string) => void;
}

/**
 * One purchase order. A draft can be edited freely; once placed it can only be received
 * against or stopped. Placing and cancelling are for owners and managers — those buttons are
 * not shown to anyone else, and the main process refuses them regardless.
 */
export function PurchaseOrderEditor({ poId, suppliers, onBack, onChanged }: PurchaseOrderEditorProps): JSX.Element | null {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopReason, setStopReason] = useState("");

  const load = useCallback(
    (id: string) => {
      if (!user || !context) return;
      purchaseOrdersService
        .get(id, user.id)
        .then((result) => {
          if ("ok" in result) {
            setLoadError(result.error);
            return;
          }
          setDetail(result);
          setSupplierId(result.order.supplierId);
          setExpectedDate(result.order.expectedDate ?? "");
          setNotes(result.order.notes ?? "");
          setIsTaxInclusive(result.items.some((i) => i.isTaxInclusive));
          setLines(
            result.items.map((i) => ({
              lineId: i.id,
              productId: i.productId,
              name: i.productName,
              uom: i.uom,
              qty: i.qtyOrdered,
              costRupees: i.costPricePaise / 100,
              taxRatePercent: i.taxRatePercent,
              snapshot: null,
            })),
          );

          const productIds = [...new Set(result.items.map((i) => i.productId))];
          if (productIds.length === 0) return;
          purchasesService
            .getPriceSnapshots(context.storeId, productIds, user.id)
            .then((snapshots) => {
              if (isDenied(snapshots)) return;
              setLines((prev) => prev.map((l) => ({ ...l, snapshot: snapshots[l.productId] ?? null })));
            })
            .catch(() => {
              // Lines just keep showing without a warning tag or averaged-cost preview.
            });
        })
        .catch(() => setLoadError("Could not load the purchase order."));
    },
    [user, context],
  );

  useEffect(() => {
    if (poId) load(poId);
  }, [poId, load]);

  useEffect(() => {
    if (!context) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = productQuery.trim();
    if (trimmed.length === 0) {
      setProductResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      productsService
        .search(context.storeId, trimmed)
        .then((found) => setProductResults(found.slice(0, 8)))
        .catch(() => setProductResults([]));
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [productQuery, context]);

  if (!context || !user) return null;

  const status = detail?.order.status ?? "draft";
  const editable = status === "draft";
  const mayPlace = canPlacePurchaseOrder(user.role);
  const stoppable = status === "draft" || status === "ordered" || status === "partially_received";

  const { lines: computedLines, totals } = computePurchaseTotals(
    lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      costPricePaise: rupeesToPaise(l.costRupees),
      taxRatePercent: l.taxRatePercent,
      isTaxInclusive,
    })),
  );

  // The margin warning tag, against the snapshot's sale/wholesale price — no confirm-on-save
  // here, since saving a draft or placing an order moves no stock or cost.
  const lineWarnings = lines.map((line, index) => {
    if (!line.snapshot) return [];
    const computed = computedLines[index];
    const costExTaxPaise = computed && line.qty > 0 ? Math.round(computed.taxablePaise / line.qty) : 0;
    return findMarginWarnings({
      costPricePaise: costExTaxPaise,
      salePricePaise: line.snapshot.salePricePaise,
      wholesalePricePaise: line.snapshot.wholesalePricePaise,
      taxRatePercent: line.snapshot.taxRatePercent,
      isTaxInclusive: line.snapshot.isTaxInclusive,
    });
  });

  function addLine(product: ProductSearchResult): void {
    if (!context || !user) return;
    const lineId = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      {
        lineId,
        productId: product.productId,
        name: product.name,
        uom: product.uom,
        qty: 1,
        // Seeded at 0 until the snapshot below comes back — never from the sale price.
        costRupees: 0,
        taxRatePercent: product.taxRatePercent,
        snapshot: null,
      },
    ]);
    setProductQuery("");
    setProductResults([]);

    purchasesService
      .getPriceSnapshots(context.storeId, [product.productId], user.id)
      .then((result) => {
        if (isDenied(result)) return;
        const snapshot = result[product.productId] ?? null;
        updateLine(lineId, { snapshot, costRupees: snapshot ? snapshot.costPricePaise / 100 : 0 });
      })
      .catch(() => {
        // Keep the line with a blank cost box — it can still be typed by hand.
      });
  }

  function updateLine(lineId: string, patch: Partial<EditorLine>): void {
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  }

  function payloadLines() {
    return lines.map((l) => ({
      productId: l.productId,
      qtyOrdered: l.qty,
      costPricePaise: rupeesToPaise(l.costRupees),
      taxRatePercent: l.taxRatePercent,
      isTaxInclusive,
    }));
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !user) return;
    setMessage(null);
    if (!supplierId) {
      setMessage("Pick a supplier first.");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !(l.qty > 0))) {
      setMessage("Add at least one item, each with a quantity above zero.");
      return;
    }
    setBusy(true);
    const result = detail
      ? await purchaseOrdersService.update({
          poId: detail.order.id,
          actingUserId: user.id,
          expectedDate: expectedDate || null,
          notes: notes.trim() || null,
          lines: payloadLines(),
        })
      : await purchaseOrdersService.create({
          storeId: context.storeId,
          actingUserId: user.id,
          supplierId,
          expectedDate: expectedDate || null,
          notes: notes.trim() || null,
          lines: payloadLines(),
        });
    setBusy(false);
    if (!result.ok || !result.order) {
      setMessage(result.error ?? "Could not save the purchase order.");
      return;
    }
    setMessage(`Draft ${result.order.poNo} saved.`);
    load(result.order.id);
    onChanged(result.order.id);
  }

  async function handlePlace(): Promise<void> {
    if (!detail || !user) return;
    setBusy(true);
    setMessage(null);
    const result = await purchaseOrdersService.place(detail.order.id, user.id);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not place the order.");
      return;
    }
    setMessage(`${detail.order.poNo} placed. Receive goods here when they arrive.`);
    load(detail.order.id);
    onChanged(detail.order.id);
  }

  async function handleStop(): Promise<void> {
    if (!detail || !user) return;
    const closing = detail.order.status === "partially_received";
    setBusy(true);
    setMessage(null);
    const result = await purchaseOrdersService.cancel(detail.order.id, user.id, stopReason.trim() || null);
    setBusy(false);
    setStopping(false);
    setStopReason("");
    if (!result.ok) {
      setMessage(result.error ?? "Could not stop the order.");
      return;
    }
    setMessage(closing ? `${detail.order.poNo} closed.` : `${detail.order.poNo} cancelled.`);
    load(detail.order.id);
    onChanged(detail.order.id);
  }

  if (poId && !detail) {
    return (
      <>
        <button type="button" className="btn btn-ghost purch-back" onClick={onBack}>
          ← Purchase orders
        </button>
        <BlueprintCard>
          <p className={loadError ? "error-text" : "text-muted"}>{loadError ?? "Loading…"}</p>
        </BlueprintCard>
      </>
    );
  }

  const itemById = new Map((detail?.items ?? []).map((i) => [i.id, i]));

  return (
    <>
      <button type="button" className="btn btn-ghost purch-back" onClick={onBack}>
        ← Purchase orders
      </button>
      <BlueprintCard>
      <form onSubmit={handleSave}>
        <h2>
          {detail ? detail.order.poNo : "New purchase order"}
          <span className={`pill ${PO_STATUS_PILL[status]}`}>{PO_STATUS_LABEL[status]}</span>
        </h2>

        <div className="purch-fields">
          <div className="field">
            <label>Supplier</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!!detail}>
              <option value="">— select —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {detail && !suppliers.some((s) => s.id === detail.order.supplierId) && (
                <option value={detail.order.supplierId}>{detail.supplierName}</option>
              )}
            </select>
          </div>
          <div className="field">
            <label>Expected by</label>
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} placeholder="Optional" />
          </div>
        </div>

        {editable && (
          <>
            <div className="purch-checks">
              <label className="purch-check">
                <input type="checkbox" checked={isTaxInclusive} onChange={(e) => setIsTaxInclusive(e.target.checked)} />
                Supplier rates already include GST
              </label>
            </div>
            <div className="field purch-search">
              <label>Add product</label>
              <input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Search by name, SKU or barcode"
              />
              {productResults.length > 0 && (
                <div className="product-picker-results">
                  {productResults.map((product) => (
                    <div key={product.productId} className="product-picker-row" onClick={() => addLine(product)}>
                      <div>{product.name}</div>
                      <div className="product-picker-sub">
                        Stock: {product.stockOnHand} {product.uom}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="table-scroll">
          <table className="table purch-lines">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Ordered</th>
                {!editable && <th className="num">Received</th>}
                <th className="num">Cost / unit (₹)</th>
                <th className="num">GST %</th>
                {editable && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const item = itemById.get(line.lineId);
                return (
                  <tr key={line.lineId}>
                    <td>
                      {line.name}
                      <div className="purch-line-hint">per {line.uom}</div>
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={isFractionalUom(line.uom) ? 0.01 : 1}
                          value={line.qty}
                          onChange={(e) => updateLine(line.lineId, { qty: roundQtyForUom(Number(e.target.value), line.uom) })}
                          className="purch-in-qty"
                        />
                      ) : (
                        line.qty
                      )}
                    </td>
                    {!editable && <td className="num">{item ? `${item.qtyReceived} (${item.qtyRemaining} due)` : "—"}</td>}
                    <td className="num">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.costRupees}
                          onChange={(e) => updateLine(line.lineId, { costRupees: Number(e.target.value) })}
                          className="purch-in-money"
                        />
                      ) : (
                        line.costRupees.toFixed(2)
                      )}
                      {lineWarnings[index]?.map((w) => (
                        <div key={w.kind} className="tag tag-warn">
                          {w.message}
                        </div>
                      ))}
                    </td>
                    <td className="num">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={line.taxRatePercent}
                          onChange={(e) => updateLine(line.lineId, { taxRatePercent: Number(e.target.value) })}
                          className="purch-in-gst"
                        />
                      ) : (
                        line.taxRatePercent
                      )}
                    </td>
                    {editable && (
                      <td>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setLines((prev) => prev.filter((l) => l.lineId !== line.lineId))}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="purch-table-note">
                    No items yet — search for a product above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="purch-foot">
        <div className="purch-totals grow">
          <div className="row net">
            <span>Order value</span>
            <span>{formatIndianCurrency(editable ? totals.totalPaise : (detail?.order.totalPaise ?? 0))}</span>
          </div>
        </div>

        <div className="purch-actions">
          {editable && (
            <button type="submit" className="primary-btn" disabled={busy || lines.length === 0}>
              {detail ? "Save draft" : "Create draft"}
            </button>
          )}
          {editable && detail && mayPlace && (
            <button type="button" className="primary-btn" disabled={busy} onClick={() => void handlePlace()}>
              Place order
            </button>
          )}
          {detail && (status === "ordered" || status === "partially_received") && (
            <button type="button" className="primary-btn" disabled={busy} onClick={() => setReceiving(true)}>
              Receive goods
            </button>
          )}
          {detail && stoppable && mayPlace && !stopping && (
            <button
              type="button"
              className={status === "partially_received" ? "secondary-btn" : "danger-btn"}
              disabled={busy}
              onClick={() => setStopping(true)}
            >
              {status === "partially_received" ? "Close order" : "Cancel order"}
            </button>
          )}
        </div>
        </div>
        {detail && stopping && (
          <div className="po-stop-confirm">
            <div className="purch-stop-text">
              {status === "partially_received"
                ? `Close ${detail.order.poNo}? What has arrived stays in stock; nothing more will be received against it.`
                : `Cancel ${detail.order.poNo}? Nothing has been received against it.`}
            </div>
            <div className="field">
              <label htmlFor="po-stop-reason">Reason (optional)</label>
              <input id="po-stop-reason" value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
            </div>
            <div className="purch-actions">
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => setStopping(false)}>
                Keep order
              </button>
              <button
                type="button"
                className={status === "partially_received" ? "primary-btn" : "danger-btn"}
                disabled={busy}
                onClick={() => void handleStop()}
              >
                {status === "partially_received" ? "Close order" : "Cancel order"}
              </button>
            </div>
          </div>
        )}
        {editable && detail && !mayPlace && (
          <div className="note purch-hint">An owner or manager places the order with the supplier.</div>
        )}
        {message && <div className="purch-message">{message}</div>}
      </form>
      </BlueprintCard>

      {detail && detail.receipts.length > 0 && (
        <BlueprintCard>
          <h2>Deliveries received</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Invoice date</th>
                <th>Recorded</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.receipts.map((r) => (
                <tr key={r.purchaseId}>
                  <td>{r.invoiceNo ?? "—"}</td>
                  <td>{r.invoiceDate}</td>
                  <td>{new Date(r.createdAt).toLocaleString("en-IN")}</td>
                  <td className="num">{formatIndianCurrency(r.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </BlueprintCard>
      )}

      {receiving && detail && (
        <ReceiveGoodsModal
          detail={detail}
          onClose={() => setReceiving(false)}
          onReceived={(text) => {
            setReceiving(false);
            setMessage(text);
            load(detail.order.id);
            onChanged(detail.order.id);
          }}
        />
      )}
    </>
  );
}
