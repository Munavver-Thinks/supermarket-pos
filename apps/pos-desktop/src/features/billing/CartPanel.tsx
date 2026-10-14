import { useState } from "react";
import {
  billingShortcutLabel,
  computeCartTotals,
  formatIndianCurrency,
  isFractionalUom,
  parseDiscountInput,
  roundQtyForUom,
} from "@pos/business-logic";
import type { StockShortfall } from "@pos/business-logic";
import type { Cart } from "@pos/types";
import type { NegativeStockPolicy } from "@shared/ipc.js";

import { useCartStore, type PendingReturn } from "../../store/cartStore.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";
import { BILLING_FOCUS_IDS, focusById, lineQtyInputId } from "./useBillingShortcuts.js";

interface CartPanelProps {
  cart: Cart;
  /** Products asking for more than is on hand, worked out by the screen (see BillingScreen). */
  shortfalls: StockShortfall[];
  /** The store blocks sales beyond stock and this bill has a shortfall. */
  checkoutBlocked: boolean;
  stockPolicy: NegativeStockPolicy;
  onCheckout: () => void;
  /** The return picked for this bill (F12), if any — its value comes off the total below. */
  pendingReturn?: PendingReturn | null;
  onRemoveReturn: () => void;
  /** Settles a pending return on its own, with no new items on the bill. */
  onRefundOnly: () => void;
}

/** Raw discount text, keyed by lineId for line boxes and by cart for the bill-level box. */
type DiscountText = Record<string, string>;

export function CartPanel({
  cart,
  shortfalls,
  checkoutBlocked,
  stockPolicy,
  onCheckout,
  pendingReturn,
  onRemoveReturn,
  onRefundOnly,
}: CartPanelProps): JSX.Element {
  const updateLineQty = useCartStore((s) => s.updateLineQty);
  const updateLineDiscount = useCartStore((s) => s.updateLineDiscount);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);
  const setWholesale = useCartStore((s) => s.setWholesale);
  const removeLine = useCartStore((s) => s.removeLine);

  // The boxes keep what was typed ("10%", "rs 5") rather than the parsed numbers, so the
  // cashier sees their own input back — and so an unparseable entry can sit there marked
  // invalid instead of being silently rewritten to zero.
  const [discountText, setDiscountText] = useState<DiscountText>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});

  // One CartPanel serves every bill tab, so the bill-level box is keyed by the cart it
  // belongs to. Line boxes need no such care — line ids are unique across bills.
  const billKey = `bill:${cart.clientTxnId}`;

  function handleDiscountChange(key: string, raw: string, apply: (percent: number, flatPaise: number) => void): void {
    setDiscountText((prev) => ({ ...prev, [key]: raw }));
    const parsed = parseDiscountInput(raw);
    if (!parsed) {
      setInvalid((prev) => ({ ...prev, [key]: true }));
      return;
    }
    setInvalid((prev) => ({ ...prev, [key]: false }));
    apply(parsed.discountPercent, parsed.discountFlatPaise);
  }

  // Client-side estimate only — the authoritative totals (including the below-cost
  // discount guard) are recomputed server-side in the main process before a sale is saved.
  const { lines, totals } = computeCartTotals(cart, { costPricePaiseByProduct: {}, allowBelowCost: true });
  const netPaise = totals.netPaise;
  const returnPaise = pendingReturn?.refundPaise ?? 0;

  const shortfallByProduct = new Map(shortfalls.map((s) => [s.productId, s]));

  return (
    <div className="cart-panel">
      <div className="cart-table-scroll">
        <table className="cart-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>
                Qty <ShortcutKey action="focusLastLineQty" />
              </th>
              <th className="num">Rate</th>
              <th>Disc</th>
              <th className="num">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.lineId}>
                <td>
                  <div className="cart-item-name">{line.name}</div>
                  {shortfallByProduct.has(line.productId) && (
                    <div className={"stock-hint" + (stockPolicy === "block" ? " blocking" : "")}>
                      Only {shortfallByProduct.get(line.productId)?.onHandQty ?? 0} {line.uom} in stock
                    </div>
                  )}
                </td>
                <td>
                  <input
                    id={lineQtyInputId(line.lineId)}
                    type="number"
                    min={0}
                    step={isFractionalUom(line.uom) ? 0.01 : 1}
                    aria-label={`Quantity of ${line.name}`}
                    value={line.qty}
                    onChange={(e) => updateLineQty(line.lineId, roundQtyForUom(Number(e.target.value), line.uom))}
                    onKeyDown={(e) => {
                      // Quantity fixed — back to scanning without reaching for F2.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        focusById(BILLING_FOCUS_IDS.search);
                      }
                    }}
                  />
                </td>
                <td className="num">{formatIndianCurrency(line.unitPricePaise)}</td>
                <td>
                  <input
                    className={"discount-input" + (invalid[line.lineId] ? " invalid" : "")}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Discount on ${line.name}`}
                    aria-invalid={invalid[line.lineId] ? true : undefined}
                    value={discountText[line.lineId] ?? ""}
                    onChange={(e) =>
                      handleDiscountChange(line.lineId, e.target.value, (percent, flat) =>
                        updateLineDiscount(line.lineId, percent, flat),
                      )
                    }
                  />
                  {invalid[line.lineId] ? (
                    <div className="discount-hint invalid">Enter ₹5 or 10%</div>
                  ) : (
                    line.discountPaise > 0 && (
                      <div className="discount-hint">-{formatIndianCurrency(line.discountPaise)}</div>
                    )
                  )}
                </td>
                <td className="num cart-line-total">{formatIndianCurrency(line.totalPaise)}</td>
                <td>
                  <button
                    className="cart-remove"
                    aria-label={`Remove ${line.name}`}
                    title={index === lines.length - 1 ? `Remove (${billingShortcutLabel("removeLastLine")})` : "Remove"}
                    onClick={() => removeLine(line.lineId)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="cart-empty">
                  {pendingReturn
                    ? "Only a return on this bill — add items, or refund it on its own."
                    : "Cart is empty — search or scan a product to begin."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="totals-box">
        <div className="totals-net">
          <div className="totals-net-label">
            Net Total · {lines.length} {lines.length === 1 ? "item" : "items"}
          </div>
          <div className="totals-net-value">{formatIndianCurrency(totals.netPaise)}</div>
        </div>
        {totals.discountPaise > 0 && (
          <div className="totals-saved">You saved {formatIndianCurrency(totals.discountPaise)} on this bill</div>
        )}
        <div className="totals-card">
          <div className="row">
            <span>Taxable</span>
            <span>{formatIndianCurrency(totals.taxablePaise)}</span>
          </div>
          <div className="row">
            <span>CGST</span>
            <span>{formatIndianCurrency(totals.cgstPaise)}</span>
          </div>
          <div className="row">
            <span>SGST</span>
            <span>{formatIndianCurrency(totals.sgstPaise)}</span>
          </div>
          <div className="row">
            <label htmlFor="bill-discount" className="totals-label">
              <span>
                Discount <ShortcutKey action="focusBillDiscount" />
              </span>
              <input
                id={BILLING_FOCUS_IDS.billDiscount}
                className={"discount-input bill" + (invalid[billKey] ? " invalid" : "")}
                type="text"
                inputMode="decimal"
                placeholder="whole bill"
                aria-invalid={invalid[billKey] ? true : undefined}
                value={discountText[billKey] ?? ""}
                onChange={(e) => handleDiscountChange(billKey, e.target.value, setBillDiscount)}
              />
            </label>
            <span>-{formatIndianCurrency(totals.discountPaise)}</span>
          </div>
          {invalid[billKey] && <div className="discount-hint invalid">Enter ₹5 or 10%</div>}
          <label
            className="row"
            title="Products with a wholesale rate use it from here on — anything already on the bill keeps its price."
          >
            <span className="totals-label">
              <input
                className="wholesale-check"
                type="checkbox"
                checked={cart.isWholesale ?? false}
                onChange={(e) => setWholesale(e.target.checked)}
              />
              Wholesale bill <ShortcutKey action="toggleWholesale" />
            </span>
          </label>
        </div>
        {pendingReturn && (
          <div className="totals-card totals-return">
            <div className="row">
              <span className="totals-label">
                <button className="cart-remove" aria-label="Remove return from this bill" onClick={onRemoveReturn}>
                  ✕
                </button>
                Return · {pendingReturn.originalBillNo}
              </span>
              <span>-{formatIndianCurrency(returnPaise)}</span>
            </div>
            <div className="totals-note">
              {pendingReturn.lines.map((l) => `${l.productName} × ${l.qty}${l.uom}`).join(", ")}
            </div>
            <div className="row net">
              <span>{netPaise >= returnPaise ? "To pay" : "To give back"}</span>
              <span>{formatIndianCurrency(Math.abs(netPaise - returnPaise))}</span>
            </div>
          </div>
        )}
        {checkoutBlocked && (
          <div className="stock-hint blocking">
            This store blocks sales beyond recorded stock. Lower the quantity, or correct the stock in Inventory.
          </div>
        )}
        <button
          className="primary-btn pay-btn"
          disabled={lines.length > 0 ? checkoutBlocked : !pendingReturn}
          onClick={lines.length > 0 ? onCheckout : onRefundOnly}
        >
          {lines.length === 0 && pendingReturn ? (
            <>Refund {formatIndianCurrency(returnPaise)} (no new items)</>
          ) : pendingReturn && netPaise < returnPaise ? (
            <>
              Settle — give back {formatIndianCurrency(returnPaise - netPaise)} <ShortcutKey action="openPayment" />
            </>
          ) : (
            <>
              Payment ({formatIndianCurrency(netPaise - returnPaise)}) <ShortcutKey action="openPayment" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
