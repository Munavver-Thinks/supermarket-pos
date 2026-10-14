import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatIndianCurrency,
  formatPackBreakdown,
  formatStockBreakdown,
  formatStockQty,
  totalStockQty,
} from "@pos/business-logic";
import type { LowStockRow, ProductAdminRow, Supplier } from "@pos/types";

import { inventoryService } from "@/services/inventoryService.js";
import { productsService } from "@/services/productsService.js";
import { suppliersService } from "@/services/suppliersService.js";
import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { useConfirm } from "@/context/ConfirmContext/index.js";
import { Icon } from "@/components/Icon/index.js";

import { useAlertsStore } from "../../store/alertsStore.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { AddProductModal } from "./AddProductModal.js";
import { ExpiryCard } from "./ExpiryCard.js";
import { LabelPrintModal } from "./LabelPrintModal.js";
import { ProductEditModal } from "./ProductEditModal.js";
import type { PickedProduct } from "./ProductPicker.js";
import { StockAdjustModal } from "./StockAdjustModal.js";

export function InventoryScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const refreshAlerts = useAlertsStore((s) => s.refresh);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);

  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [products, setProducts] = useState<ProductAdminRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adjustPreset, setAdjustPreset] = useState<PickedProduct | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [labelProductId, setLabelProductId] = useState<string | null>(null);
  const [expiryKey, setExpiryKey] = useState(0);

  const refreshLowStock = useCallback(() => {
    if (!context) return;
    inventoryService.getLowStock(context.storeId).then(setLowStock).catch(() => undefined);
  }, [context]);

  const refreshProducts = useCallback(() => {
    if (!context || !user) return;
    productsService
      .listAdmin({
        storeId: context.storeId,
        actingUserId: user.id,
        query: query.trim(),
        includeInactive: showInactive,
        limit: 200,
      })
      .then((result) => {
        if ("ok" in result) {
          setListError(result.error);
          setProducts([]);
          return;
        }
        setListError(null);
        setProducts(result);
      })
      .catch(() => setListError("Could not load products."));
  }, [context, user, query, showInactive]);

  /** Everything that shows stock is reloaded after a change, alerts included. */
  const afterStockChange = useCallback(() => {
    refreshLowStock();
    refreshProducts();
    setExpiryKey((k) => k + 1);
    if (context) void refreshAlerts(context.storeId);
  }, [refreshLowStock, refreshProducts, refreshAlerts, context]);

  useEffect(refreshLowStock, [refreshLowStock]);

  useEffect(() => {
    if (context) void refreshAlerts(context.storeId);
  }, [context, refreshAlerts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refreshProducts, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refreshProducts]);

  useEffect(() => {
    if (!context) return;
    suppliersService
      .list(context.storeId)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [context]);

  function adjust(row: { productId: string; name: string; uom: string; qtyOnHand: number }): void {
    setAdjustPreset({ productId: row.productId, name: row.name, uom: row.uom, stockOnHand: row.qtyOnHand });
    setShowAdjust(true);
  }

  async function toggleActive(row: ProductAdminRow): Promise<void> {
    if (!user) return;
    setListMessage(null);
    if (row.isActive) {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      let ok = false;
      try {
        ok = await confirm({
          title: `Deactivate ${row.name}?`,
          message: "It will no longer be found or scanned in billing.",
          cancelLabel: "Keep",
          confirmLabel: "Deactivate",
        });
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    const result = await productsService.setActive({
      productId: row.id,
      actingUserId: user.id,
      isActive: !row.isActive,
    });
    if (!result.ok) {
      setListMessage(result.error ?? "Could not change the product.");
      return;
    }
    setListMessage(row.isActive ? `${row.name} is no longer on sale.` : `${row.name} is on sale again.`);
    afterStockChange();
  }

  const lowStockIds = new Set(lowStock.map((r) => r.productId));

  return (
    <div className="screen-section">
      <div className="tools-row">
        <div className="p5b-search inv-search">
          <Icon name="search" size={20} />
          <label className="p5b-sr" htmlFor="inventory-search">
            Find
          </label>
          <input
            id="inventory-search"
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, short code or barcode"
          />
        </div>
        <label className="p5b-check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated
        </label>
        <button
          type="button"
          className="secondary-btn p5b-push"
          onClick={() => {
            setAdjustPreset(null);
            setShowAdjust(true);
          }}
        >
          Adjust Stock
        </button>
        <button type="button" className="primary-btn" onClick={() => setShowAddProduct(true)}>
          + Add Product
        </button>
      </div>

      <div className="inv-split">
        <BlueprintCard>
          <h2>Products</h2>
          {listError && <div className="error-text">{listError}</div>}
          {listMessage && <div className="p5b-msg">{listMessage}</div>}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Code / barcode</th>
                  <th className="num">Sale price</th>
                  <th className="num">Stock</th>
                  <th className="num">Reorder at</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(products ?? []).map((row) => (
                  <tr key={row.id} className={row.isActive ? undefined : "row-inactive"}>
                    <td>
                      {row.name}
                      {!row.isActive && <span className="pill mute inv-pill-after">Deactivated</span>}
                      {row.nameTamil && (
                        <div className="note" lang="ta">
                          {row.nameTamil}
                        </div>
                      )}
                      {row.parentName && <div className="note">Pack of {row.parentName}</div>}
                      {row.rackLocation && <div className="note">Rack {row.rackLocation}</div>}
                    </td>
                    <td>
                      {row.shortCode ?? "—"}
                      {row.barcodes.length > 0 && <div className="note">{row.barcodes.join(", ")}</div>}
                    </td>
                    <td className="num">{formatIndianCurrency(row.salePricePaise)}</td>
                    <td className={lowStockIds.has(row.id) ? "num inv-low" : "num"}>
                      {row.packStockQty === null ? (
                        <>
                          {row.qtyOnHand} {row.uom}
                        </>
                      ) : (
                        <>
                          {formatStockQty(totalStockQty(row.qtyOnHand, row.packStockQty))} {row.uom}
                          <div className="note">{formatPackBreakdown(row.qtyOnHand, row.uom, row.packs ?? [])}</div>
                        </>
                      )}
                    </td>
                    <td className="num">{row.reorderLevel > 0 ? row.reorderLevel : "—"}</td>
                    <td className="r p5b-nowrap">
                      <button type="button" className="btn btn-ghost" onClick={() => setEditingId(row.id)}>
                        Edit
                      </button>{" "}
                      {row.isActive && (
                        <>
                          <button type="button" className="btn btn-ghost" onClick={() => setLabelProductId(row.id)}>
                            Labels
                          </button>{" "}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => adjust({ ...row, productId: row.id })}
                          >
                            Adjust
                          </button>{" "}
                        </>
                      )}
                      <button
                        type="button"
                        className={row.isActive ? "btn btn-ghost p5b-danger-text" : "btn btn-ghost"}
                        onClick={() => void toggleActive(row)}
                      >
                        {row.isActive ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
                {products !== null && products.length === 0 && !listError && (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      {query.trim() ? "No product matches." : "No products yet — click + Add Product above."}
                    </td>
                  </tr>
                )}
                {products === null && (
                  <tr>
                    <td colSpan={6} className="text-muted">
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </BlueprintCard>

        <div className="inv-side">
          <BlueprintCard>
            <h2>Low Stock</h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Stock</th>
                    <th className="num">Reorder Level</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((row) => (
                    <tr key={row.productId}>
                      <td>
                        {row.name}{" "}
                        <span className={"pill " + (row.kind === "out_of_stock" ? "bad" : "warn")}>
                          {row.kind === "out_of_stock" ? "Out of stock" : "Low"}
                        </span>
                      </td>
                      <td className="num">{formatStockBreakdown(row.qtyOnHand, row.packStockQty, row.uom)}</td>
                      <td className="num">{row.reorderLevel > 0 ? row.reorderLevel : "—"}</td>
                      <td className="r">
                        <button type="button" className="btn btn-ghost" onClick={() => adjust(row)}>
                          Adjust
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lowStock.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-muted">
                        No low stock items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </BlueprintCard>

          <ExpiryCard refreshKey={expiryKey} onChanged={afterStockChange} />
        </div>
      </div>

      {editingId && (
        <ProductEditModal
          productId={editingId}
          suppliers={suppliers}
          onClose={() => setEditingId(null)}
          onSaved={afterStockChange}
        />
      )}

      {labelProductId && <LabelPrintModal productId={labelProductId} onClose={() => setLabelProductId(null)} />}

      {showAddProduct && context && user && (
        <AddProductModal
          storeId={context.storeId}
          userId={user.id}
          suppliers={suppliers}
          onCreated={afterStockChange}
          onClose={() => setShowAddProduct(false)}
        />
      )}

      {showAdjust && (
        <StockAdjustModal
          preset={adjustPreset}
          onSaved={afterStockChange}
          onClose={() => {
            setShowAdjust(false);
            setAdjustPreset(null);
          }}
        />
      )}
    </div>
  );
}
