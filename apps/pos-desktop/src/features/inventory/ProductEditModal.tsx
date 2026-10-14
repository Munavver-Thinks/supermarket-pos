import { useCallback, useEffect, useRef, useState } from "react";
import {
  canChangePrices,
  findMarginWarnings,
  formatStockBreakdown,
  isFractionalUom,
  marginConfirmText,
  roundQtyForUom,
} from "@pos/business-logic";
import type { ProductForEdit, Supplier } from "@pos/types";

import { productsService } from "@/services/productsService.js";
import { parseRupeesStrict } from "@/utils/money.js";

import { useConfirm } from "../../components/ConfirmDialog.js";
import { Icon } from "../../components/icons.js";
import { useModalKeyboard } from "../../components/useModalKeyboard.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { PackSizesSection } from "./PackSizesSection.js";

interface ProductEditModalProps {
  productId: string;
  suppliers: Supplier[];
  onClose: () => void;
  /** Called after any change is saved, so the list behind can refresh. */
  onSaved: () => void;
}

const UNITS = ["pcs", "kg", "g", "l", "ml"];

function listText(values: string[]): string {
  return values.join(", ");
}

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Edit a product's details and, for owners and managers, its prices. The two save separately:
 * a price change is effective-dated (old bills keep their price) and is logged on its own.
 */
export function ProductEditModal({ productId, suppliers, onClose, onSaved }: ProductEditModalProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const [product, setProduct] = useState<ProductForEdit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The bulk product this one is a pack size of, for the "all forms together" cross-reference —
  // fetched separately since the edit screen otherwise only has this product's own row.
  const [parentInfo, setParentInfo] = useState<ProductForEdit | null>(null);

  const [details, setDetails] = useState({
    name: "",
    nameTamil: "",
    shortCode: "",
    supplierId: "",
    uom: "pcs",
    isWeighted: false,
    hsnCode: "",
    taxRatePercent: "0",
    barcodes: "",
    aliases: "",
    reorderLevel: "0",
    rackLocation: "",
    shelfLifeDays: "",
  });
  const [prices, setPrices] = useState({ mrp: "", salePrice: "", costPrice: "", wholesalePrice: "", isTaxInclusive: true });
  const [busy, setBusy] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [pricesMessage, setPricesMessage] = useState<string | null>(null);
  // A linked child's price fields are read-only until this is set — "Unlock to edit manually"
  // flips it, and saving a real change unlinks the child server-side as a side effect.
  const [unlockedForEdit, setUnlockedForEdit] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);
  useModalKeyboard(cardRef);

  const loadProduct = useCallback(() => {
    if (!user) return;
    productsService
      .get(productId, user.id)
      .then((result) => {
        if ("ok" in result) {
          setLoadError(result.error);
          return;
        }
        setProduct(result);
        setDetails({
          name: result.name,
          nameTamil: result.nameTamil ?? "",
          shortCode: result.shortCode ?? "",
          supplierId: result.supplierId ?? "",
          uom: result.uom,
          isWeighted: result.isWeighted,
          hsnCode: result.hsnCode ?? "",
          taxRatePercent: String(result.taxRatePercent),
          barcodes: listText(result.barcodes),
          aliases: listText(result.aliases),
          reorderLevel: String(result.reorderLevel),
          rackLocation: result.rackLocation ?? "",
          shelfLifeDays: result.shelfLifeDays === null ? "" : String(result.shelfLifeDays),
        });
        setPrices({
          mrp: rupees(result.mrpPaise),
          salePrice: rupees(result.salePricePaise),
          costPrice: rupees(result.costPricePaise),
          wholesalePrice: result.wholesalePricePaise !== null ? rupees(result.wholesalePricePaise) : "",
          isTaxInclusive: result.isTaxInclusive,
        });
        setUnlockedForEdit(false);
      })
      .catch(() => setLoadError("Could not load the product."));
  }, [productId, user]);

  useEffect(loadProduct, [loadProduct]);

  useEffect(() => {
    if (!user || !product?.parentProductId) {
      setParentInfo(null);
      return;
    }
    const parentProductId = product.parentProductId;
    productsService
      .get(parentProductId, user.id)
      .then((result) => {
        if ("ok" in result) {
          setParentInfo(null);
          return;
        }
        setParentInfo(result);
      })
      .catch(() => setParentInfo(null));
  }, [product, user]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pricesAllowed = user ? canChangePrices(user.role) : false;
  const isChild = product?.parentProductId != null;
  const linked = product?.priceLinkedToParent ?? false;
  const priceFieldsDisabled = !pricesAllowed || (isChild && linked && !unlockedForEdit);

  const priceWarnings = product
    ? findMarginWarnings({
        costPricePaise: parseRupeesStrict(prices.costPrice || "0"),
        salePricePaise: parseRupeesStrict(prices.salePrice || "0"),
        wholesalePricePaise: prices.wholesalePrice.trim() ? parseRupeesStrict(prices.wholesalePrice) : null,
        taxRatePercent: product.taxRatePercent,
        isTaxInclusive: prices.isTaxInclusive,
      })
    : [];

  async function saveDetails(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user) return;
    setDetailsMessage(null);
    const shelfLifeText = details.shelfLifeDays.trim();
    const shelfLifeDays = shelfLifeText === "" ? null : Number(shelfLifeText);
    if (shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650)) {
      setDetailsMessage("Shelf life must be a whole number of days, from 1 to 3650.");
      return;
    }
    setBusy(true);
    const result = await productsService.update({
      productId,
      actingUserId: user.id,
      details: {
        name: details.name.trim(),
        nameTamil: details.nameTamil.trim() || null,
        shortCode: details.shortCode.trim() || null,
        supplierId: details.supplierId || null,
        uom: details.uom,
        isWeighted: details.isWeighted,
        hsnCode: details.hsnCode.trim() || null,
        taxRatePercent: Number(details.taxRatePercent) || 0,
        barcodes: parseList(details.barcodes),
        aliases: parseList(details.aliases),
        reorderLevel: Math.max(0, roundQtyForUom(Number(details.reorderLevel) || 0, details.uom)),
        rackLocation: details.rackLocation.trim() || null,
        shelfLifeDays,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setDetailsMessage(result.error ?? "Could not save the product.");
      return;
    }
    if (result.product) setProduct(result.product);
    setDetailsMessage("Details saved.");
    onSaved();
  }

  async function savePrices(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || confirmingRef.current) return;
    setPricesMessage(null);
    const mrpPaise = parseRupeesStrict(prices.mrp);
    const salePricePaise = parseRupeesStrict(prices.salePrice);
    const costPricePaise = parseRupeesStrict(prices.costPrice);
    const wholesalePricePaise = prices.wholesalePrice.trim() ? parseRupeesStrict(prices.wholesalePrice) : null;
    if ([mrpPaise, salePricePaise, costPricePaise].some((v) => !Number.isFinite(v) || v < 0)) {
      setPricesMessage("Enter each price as an amount in rupees.");
      return;
    }
    if (wholesalePricePaise !== null && (!Number.isFinite(wholesalePricePaise) || wholesalePricePaise < 0)) {
      setPricesMessage("Enter the wholesale price as an amount in rupees, or leave it blank.");
      return;
    }
    if (priceWarnings.length > 0) {
      let ok = false;
      confirmingRef.current = true;
      try {
        ok = await confirm({
          title: "Price below cost",
          message: marginConfirmText(product?.name ?? details.name, priceWarnings),
          cancelLabel: "Go back",
          confirmLabel: "Save anyway",
        });
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    setBusy(true);
    const result = await productsService.changePrices({
      productId,
      actingUserId: user.id,
      prices: { mrpPaise, salePricePaise, costPricePaise, wholesalePricePaise, isTaxInclusive: prices.isTaxInclusive },
    });
    setBusy(false);
    if (!result.ok) {
      setPricesMessage(result.error ?? "Could not change the prices.");
      return;
    }
    setPricesMessage(result.changed ? "New prices apply from now on. Earlier bills keep their prices." : "No change.");
    if (result.changed) {
      // A direct edit on a child unlinks it server-side — reload so that shows up here too.
      loadProduct();
      onSaved();
    }
  }

  async function handleRelink(): Promise<void> {
    if (!user) return;
    setBusy(true);
    setPricesMessage(null);
    const result = await productsService.relinkChildPrice(productId, user.id);
    setBusy(false);
    if (!result.ok) {
      setPricesMessage(result.error ?? "Could not relink the price.");
      return;
    }
    loadProduct();
    setPricesMessage("Relinked — following the parent's price again.");
    onSaved();
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card product-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-edit-title"
        ref={cardRef}
      >
        <div className="popup-head">
          <h2 id="product-edit-title">Edit product</h2>
          <button type="button" className="btn btn-ghost popup-close" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        {loadError && <div className="error-text">{loadError}</div>}
        {!product && !loadError && <div className="text-muted">Loading…</div>}

        {product && (
          <>
            <form onSubmit={saveDetails}>
              <h4 className="popup-kicker">Details</h4>
              {parentInfo && (
                <p className="popup-note">
                  Pack size of {parentInfo.name} ({product.packQty} {parentInfo.uom} each). All forms together:{" "}
                  {formatStockBreakdown(parentInfo.qtyOnHand, parentInfo.packStockQty, parentInfo.uom)}. To make more
                  packs, edit {parentInfo.name} and use Repack.
                </p>
              )}
              <div className="form-grid-3">
                <div className="field">
                  <label>Name</label>
                  <input required value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Name (Tamil)</label>
                  <input value={details.nameTamil} onChange={(e) => setDetails({ ...details, nameTamil: e.target.value })} />
                </div>
                <div className="field">
                  <label>Short code / SKU</label>
                  <input value={details.shortCode} onChange={(e) => setDetails({ ...details, shortCode: e.target.value })} />
                </div>
                <div className="field">
                  <label>Supplier</label>
                  <select value={details.supplierId} onChange={(e) => setDetails({ ...details, supplierId: e.target.value })}>
                    <option value="">— none —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Unit</label>
                  <select value={details.uom} onChange={(e) => setDetails({ ...details, uom: e.target.value })}>
                    {[...new Set([...UNITS, details.uom])].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>HSN code</label>
                  <input value={details.hsnCode} onChange={(e) => setDetails({ ...details, hsnCode: e.target.value })} />
                </div>
                <div className="field">
                  <label>GST rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={details.taxRatePercent}
                    onChange={(e) => setDetails({ ...details, taxRatePercent: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Reorder level</label>
                  <input
                    type="number"
                    min={0}
                    step={isFractionalUom(details.uom) ? 0.01 : 1}
                    value={details.reorderLevel}
                    onChange={(e) => setDetails({ ...details, reorderLevel: e.target.value })}
                  />
                  {product.packStockQty !== null && (
                    <p className="popup-hint">Compared against the total, loose plus all pack sizes.</p>
                  )}
                </div>
                <div className="field">
                  <label>Rack / shelf</label>
                  <input
                    maxLength={40}
                    placeholder="e.g. B-3"
                    value={details.rackLocation}
                    onChange={(e) => setDetails({ ...details, rackLocation: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Shelf life (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={details.shelfLifeDays}
                    onChange={(e) => setDetails({ ...details, shelfLifeDays: e.target.value })}
                  />
                  <p className="popup-hint">
                    For packs you make in-store — sets the default best-before when repacking.
                  </p>
                </div>
                <div className="field">
                  <label>Barcodes (comma separated)</label>
                  <input value={details.barcodes} onChange={(e) => setDetails({ ...details, barcodes: e.target.value })} />
                </div>
                <div className="field">
                  <label>Other names for search (comma separated)</label>
                  <input value={details.aliases} onChange={(e) => setDetails({ ...details, aliases: e.target.value })} />
                </div>
              </div>
              <label className="popup-check">
                <input
                  type="checkbox"
                  checked={details.isWeighted}
                  onChange={(e) => setDetails({ ...details, isWeighted: e.target.checked })}
                />
                Sold by weight
              </label>
              <div className="modal-actions">
                {detailsMessage && <span className="popup-status">{detailsMessage}</span>}
                <button className="primary-btn" type="submit" disabled={busy || !details.name.trim()}>
                  Save details
                </button>
              </div>
            </form>

            <form className="popup-section" onSubmit={savePrices}>
              <div className="popup-section-head">
                <h4>Prices</h4>
                {!pricesAllowed && (
                  <span className="popup-pill warn">
                    <Icon name="lock" size={14} />
                    Only an owner or manager can change prices.
                  </span>
                )}
              </div>
              {isChild && linked && (
                <div className="popup-callout info">
                  <span>🔗 Linked to the parent product's price — changing it there updates this automatically.</span>
                  {pricesAllowed && !unlockedForEdit && (
                    <button type="button" className="btn btn-ghost" onClick={() => setUnlockedForEdit(true)}>
                      Unlock to edit manually
                    </button>
                  )}
                </div>
              )}
              {isChild && !linked && pricesAllowed && (
                <button
                  type="button"
                  className="secondary-btn popup-btn-sm"
                  onClick={() => void handleRelink()}
                  disabled={busy}
                >
                  Relink to parent price
                </button>
              )}
              <div className="form-grid-4">
                <div className="field">
                  <label>MRP (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={prices.mrp}
                    disabled={priceFieldsDisabled}
                    onChange={(e) => setPrices({ ...prices, mrp: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Sale price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={prices.salePrice}
                    disabled={priceFieldsDisabled}
                    onChange={(e) => setPrices({ ...prices, salePrice: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Cost price (₹, ex-GST)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={prices.costPrice}
                    disabled={priceFieldsDisabled}
                    onChange={(e) => setPrices({ ...prices, costPrice: e.target.value })}
                  />
                  <p className="popup-hint">
                    This is the average cost — receipts with "update cost" ticked adjust it automatically.
                  </p>
                </div>
                <div className="field">
                  <label>Wholesale price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Optional"
                    value={prices.wholesalePrice}
                    disabled={priceFieldsDisabled}
                    onChange={(e) => setPrices({ ...prices, wholesalePrice: e.target.value })}
                  />
                </div>
              </div>
              {priceWarnings.map((w) => (
                <div key={w.kind} className="error-text">
                  {w.message}
                </div>
              ))}
              <label className="popup-check">
                <input
                  type="checkbox"
                  checked={prices.isTaxInclusive}
                  disabled={priceFieldsDisabled}
                  onChange={(e) => setPrices({ ...prices, isTaxInclusive: e.target.checked })}
                />
                Sale price includes GST
              </label>
              <div className="modal-actions">
                {pricesMessage && <span className="popup-status">{pricesMessage}</span>}
                {pricesAllowed && !(isChild && linked && !unlockedForEdit) && (
                  <button className="primary-btn" type="submit" disabled={busy}>
                    Change prices
                  </button>
                )}
              </div>
            </form>

            <PackSizesSection
              parent={product}
              onChanged={() => {
                loadProduct();
                onSaved();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
