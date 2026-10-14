import { useCallback, useEffect, useRef, useState } from "react";
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
import type { ProductSearchResult, PurchaseListRow, PurchasePriceSnapshot, Supplier } from "@pos/types";
import { rupeesToPaise } from "@pos/business-logic";

import { productsService } from "@/services/productsService.js";
import { suppliersService } from "@/services/suppliersService.js";
import { isDenied } from "@/services/ipcResult.js";
import { parsePositiveRupeesOrNull } from "@/utils/money.js";
import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { useConfirm } from "@/context/ConfirmContext/index.js";
import { afterFirstLine } from "@/utils/text.js";

import { useAlertsStore } from "../../store/alertsStore.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { PurchaseOrdersPanel } from "./PurchaseOrdersPanel.js";
import { purchasesService } from "./services/purchasesService.js";


interface DraftLine {
  lineId: string;
  productId: string;
  name: string;
  uom: string;
  qty: number;
  costRupees: number;
  taxRatePercent: number;
  batchNo: string;
  expiryDate: string;
  /** Rupees as typed; blank/zero means "no change" to the product's recorded MRP. */
  mrpRupees: string;
  /** This product's current price + stock, fetched when the line is added — null while
   * loading or if it couldn't be fetched. Seeds the cost box and drives the margin warning. */
  snapshot: PurchasePriceSnapshot | null;
}

type PurchasesTab = "orders" | "direct";

export function PurchasesScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [tab, setTab] = useState<PurchasesTab>("orders");

  useEffect(() => {
    if (!context) return;
    suppliersService
      .list(context.storeId)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [context]);

  if (suppliers === null) {
    return <div className="screen-section text-muted">Loading…</div>;
  }

  if (suppliers.length === 0) {
    return (
      <div className="screen-section">
        <BlueprintCard className="purch-narrow">
          <h2>Add a supplier first</h2>
          <p className="note">
            Purchase orders and goods receipts are recorded against a supplier, so there's nothing to record against yet.
            Add the shops and distributors you buy from on the Suppliers screen, then come back here.
          </p>
        </BlueprintCard>
      </div>
    );
  }

  return (
    <div className="screen-section purch-screen">
      <div className="tab-strip" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "orders"}
          className={"tab-btn" + (tab === "orders" ? " active" : "")}
          onClick={() => setTab("orders")}
        >
          Purchase orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "direct"}
          className={"tab-btn" + (tab === "direct" ? " active" : "")}
          onClick={() => setTab("direct")}
        >
          Direct receipt
        </button>
      </div>
      {tab === "orders" ? <PurchaseOrdersPanel suppliers={suppliers} /> : <DirectReceiptPanel suppliers={suppliers} />}
    </div>
  );
}

/** Goods that arrived without an order in the app: recorded straight into stock. */
function DirectReceiptPanel({ suppliers }: { suppliers: Supplier[] }): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const refreshAlerts = useAlertsStore((s) => s.refresh);

  const [recent, setRecent] = useState<PurchaseListRow[]>([]);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => localDateIso());
  const [notes, setNotes] = useState("");
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);
  const [updateCostPrice, setUpdateCostPrice] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  // One retry key per invoice being entered: a double submit records it once.
  const clientTxnId = useRef(crypto.randomUUID());

  const refreshRecent = useCallback(() => {
    if (!context) return;
    purchasesService
      .listRecent(context.storeId, 20)
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [context]);

  useEffect(refreshRecent, [refreshRecent]);

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

  function addLine(product: ProductSearchResult): void {
    const lineId = crypto.randomUUID();
    setLines((prev) => [
      ...prev,
      {
        lineId,
        productId: product.productId,
        name: product.name,
        uom: product.uom,
        qty: 1,
        // Seeded at 0 until the product's real cost snapshot comes back below — never from
        // the sale price, which has nothing to do with what the supplier actually charged.
        costRupees: 0,
        taxRatePercent: product.taxRatePercent,
        batchNo: "",
        expiryDate: "",
        mrpRupees: "",
        snapshot: null,
      },
    ]);
    setProductQuery("");
    setProductResults([]);

    if (!context || !user) return;
    purchasesService
      .getPriceSnapshots(context.storeId, [product.productId], user.id)
      .then((result) => {
        if (isDenied(result)) return;
        const snapshot = result[product.productId] ?? null;
        updateLine(lineId, { snapshot, costRupees: snapshot ? snapshot.costPricePaise / 100 : 0 });
      })
      .catch(() => {
        // Leave the line with a blank cost box — the buyer can still type the cost by hand.
      });
  }

  function updateLine(lineId: string, patch: Partial<DraftLine>): void {
    setLines((prev) => prev.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeLine(lineId: string): void {
    setLines((prev) => prev.filter((line) => line.lineId !== lineId));
  }

  // Client-side preview only — the main process recomputes these totals from the raw
  // lines before anything is written, so a tampered renderer can't set its own prices.
  const { lines: computedLines, totals } = computePurchaseTotals(
    lines.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      costPricePaise: rupeesToPaise(line.costRupees),
      taxRatePercent: line.taxRatePercent,
      isTaxInclusive,
    })),
  );

  // Per line: the margin warning (against the snapshot's sale/wholesale price) and, when
  // "update cost" is on, a preview of what the averaged cost would become.
  const lineInfo = lines.map((line, index) => {
    const computed = computedLines[index];
    const costExTaxPaise = computed && line.qty > 0 ? Math.round(computed.taxablePaise / line.qty) : 0;
    const warnings = line.snapshot
      ? findMarginWarnings({
          costPricePaise: costExTaxPaise,
          salePricePaise: line.snapshot.salePricePaise,
          wholesalePricePaise: line.snapshot.wholesalePricePaise,
          taxRatePercent: line.snapshot.taxRatePercent,
          isTaxInclusive: line.snapshot.isTaxInclusive,
        })
      : [];
    const averagedCostPreviewPaise =
      updateCostPrice && line.snapshot && computed
        ? weightedAverageCost({
            qtyOnHandBefore: line.snapshot.qtyOnHand,
            currentCostPaise: line.snapshot.costPricePaise,
            qtyReceived: line.qty,
            receivedTaxablePaise: computed.taxablePaise,
          })
        : null;
    const mrpPaise = parsePositiveRupeesOrNull(line.mrpRupees);
    const mrpWarnings =
      mrpPaise !== null && line.snapshot
        ? findMrpWarnings({
            mrpPaise,
            salePricePaise: line.snapshot.salePricePaise,
            wholesalePricePaise: line.snapshot.wholesalePricePaise,
          })
        : [];
    return { costExTaxPaise, warnings, averagedCostPreviewPaise, mrpPaise, mrpWarnings };
  });

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !user || saving || confirmingRef.current) return;
    setMessage(null);

    if (!supplierId) {
      setMessage("Pick a supplier first.");
      return;
    }
    if (lines.length === 0) {
      setMessage("Add at least one product to the invoice.");
      return;
    }
    if (lines.some((line) => line.qty <= 0)) {
      setMessage("Every line needs a quantity greater than zero.");
      return;
    }

    const warnRows = lines
      .map((line, index) => ({ line, info: lineInfo[index] }))
      .filter(({ info }) => info?.warnings.some((w) => w.kind === "sale"))
      .map(({ line, info }) => ({
        name: line.name,
        costPricePaise: info?.costExTaxPaise ?? 0,
        salePricePaise: line.snapshot?.salePricePaise ?? 0,
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

    const mrpWarnRows = lines
      .map((line, index) => ({ line, info: lineInfo[index] }))
      .filter(({ info }) => info?.mrpWarnings.some((w) => w.kind === "sale"))
      .map(({ line, info }) => ({
        name: line.name,
        mrpPaise: info?.mrpPaise ?? 0,
        salePricePaise: line.snapshot?.salePricePaise ?? 0,
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

    setSaving(true);
    const result = await purchasesService.create({
      storeId: context.storeId,
      supplierId,
      userId: user.id,
      invoiceNo: invoiceNo.trim() || null,
      invoiceDate,
      notes: notes.trim() || null,
      updateCostPrice,
      clientTxnId: clientTxnId.current,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        costPricePaise: rupeesToPaise(line.costRupees),
        taxRatePercent: line.taxRatePercent,
        isTaxInclusive,
        batchNo: line.batchNo.trim() || null,
        expiryDate: line.expiryDate || null,
        mrpPaise: parsePositiveRupeesOrNull(line.mrpRupees),
      })),
    });
    setSaving(false);

    if (!result.ok) {
      setMessage(result.error ?? "Could not save the purchase.");
      return;
    }

    setMessage(`Purchase recorded — stock increased for ${lines.length} product(s).`);
    clientTxnId.current = crypto.randomUUID();
    setLines([]);
    setInvoiceNo("");
    setNotes("");
    refreshRecent();
    void refreshAlerts(context.storeId);
  }

  return (
    <>
      <form onSubmit={handleSave} className="blueprint">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <h2>Record Purchase</h2>
        <p className="note purch-intro">
          For goods that arrived without a purchase order. Batch, expiry and MRP are optional; stock with an expiry date
          shows up in Inventory&rsquo;s expiry list, and MRP only needs filling in when the printed price differs from
          what&rsquo;s already on file.
        </p>

        <div className="purch-fields">
          <div className="field">
            <label>Supplier</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— select —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Invoice no.</label>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" />
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

        <div className="purch-checks">
          <label className="purch-check">
            <input type="checkbox" checked={isTaxInclusive} onChange={(e) => setIsTaxInclusive(e.target.checked)} />
            Supplier rates already include GST
          </label>
          <label className="purch-check">
            <input type="checkbox" checked={updateCostPrice} onChange={(e) => setUpdateCostPrice(e.target.checked)} />
            Average into each product&apos;s cost price
          </label>
        </div>

        <div className="field purch-search">
          <label>Add product</label>
          <input
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder="Search by name, SKU, barcode or Tanglish alias"
          />
          {productResults.length > 0 && (
            <div className="product-picker-results">
              {productResults.map((product) => (
                <div key={product.productId} className="product-picker-row" onClick={() => addLine(product)}>
                  <div>
                    <div>{product.name}</div>
                    <div className="product-picker-sub">
                      Stock: {product.stockOnHand} {product.uom} · GST {product.taxRatePercent}%
                    </div>
                  </div>
                  <div className="product-picker-price">{formatIndianCurrency(product.salePricePaise)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="table-scroll">
          <table className="table purch-lines">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Cost / unit (₹)</th>
                <th className="num">MRP on pack (₹)</th>
                <th className="num">GST %</th>
                <th>Batch no.</th>
                <th>Expiry date</th>
                <th className="num">Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.lineId}>
                  <td>
                    {line.name}
                    <div className="purch-line-hint">per {line.uom}</div>
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      step={isFractionalUom(line.uom) ? 0.01 : 1}
                      value={line.qty}
                      onChange={(e) => updateLine(line.lineId, { qty: roundQtyForUom(Number(e.target.value), line.uom) })}
                      className="purch-in-qty"
                    />
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.costRupees}
                      onChange={(e) => updateLine(line.lineId, { costRupees: Number(e.target.value) })}
                      className="purch-in-money"
                    />
                    {lineInfo[index]?.averagedCostPreviewPaise != null && (
                      <div className="purch-line-hint">
                        New average: {formatIndianCurrency(lineInfo[index]!.averagedCostPreviewPaise!)}
                      </div>
                    )}
                    {lineInfo[index]?.warnings.map((w) => (
                      <div key={w.kind} className="tag tag-warn">
                        {w.message}
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.mrpRupees}
                      onChange={(e) => updateLine(line.lineId, { mrpRupees: e.target.value })}
                      placeholder={line.snapshot?.mrpPaise ? formatIndianCurrency(line.snapshot.mrpPaise).replace("₹", "") : "—"}
                      className="purch-in-money"
                    />
                    {lineInfo[index]?.mrpWarnings.map((w) => (
                      <div key={w.kind} className="tag tag-warn">
                        {w.message}
                      </div>
                    ))}
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={line.taxRatePercent}
                      onChange={(e) => updateLine(line.lineId, { taxRatePercent: Number(e.target.value) })}
                      className="purch-in-gst"
                    />
                  </td>
                  <td>
                    <input
                      value={line.batchNo}
                      onChange={(e) => updateLine(line.lineId, { batchNo: e.target.value })}
                      className="purch-in-batch"
                      placeholder="Optional"
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={line.expiryDate}
                      onChange={(e) => updateLine(line.lineId, { expiryDate: e.target.value })}
                    />
                  </td>
                  <td className="num">{formatIndianCurrency(computedLines[index]?.lineTotalPaise ?? 0)}</td>
                  <td>
                    <button className="secondary-btn" type="button" onClick={() => removeLine(line.lineId)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={9} className="purch-table-note">
                    No lines yet — search for a product above to start the invoice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="purch-foot">
          <div className="purch-totals">
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

          <button className="primary-btn" type="submit" disabled={saving || lines.length === 0}>
            {saving ? "Saving…" : "Record Purchase & Add Stock"}
          </button>
        </div>
        {message && <div className="purch-message">{message}</div>}
      </form>

      <BlueprintCard>
        <h2>Recent Purchases</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Supplier</th>
              <th>Invoice</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
              <th>PO</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((purchase) => (
              <tr key={purchase.id}>
                <td>{purchase.invoiceDate}</td>
                <td>{purchase.supplierName}</td>
                <td>{purchase.invoiceNo ?? "—"}</td>
                <td className="num">{purchase.itemCount}</td>
                <td className="num">{formatIndianCurrency(purchase.totalPaise)}</td>
                <td>{purchase.purchaseOrderId ? <span className="pill info">PO</span> : <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">No purchases recorded yet</div>
            Recording a purchase adds the goods to stock and leaves an audit trail.
          </div>
        )}
      </BlueprintCard>
    </>
  );
}
