import { useEffect, useRef, useState } from "react";
import { billingShortcutLabel, formatIndianCurrency, parseQuantityInput } from "@pos/business-logic";
import type { ProductSearchResult } from "@pos/types";

import { productsService } from "@/services/productsService.js";
import { Icon } from "@/components/Icon/index.js";

import { BILLING_FOCUS_IDS } from "./useBillingShortcuts.js";
import { QuantityModal } from "./QuantityModal.js";

interface SearchPanelProps {
  storeId: string;
  onAddProduct: (product: ProductSearchResult, qty: number) => void;
}

export function SearchPanel({ storeId, onAddProduct }: SearchPanelProps): JSX.Element {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Row picked with the arrow keys; -1 means none picked yet.
  const [highlight, setHighlight] = useState(-1);
  // The dropdown is a floating overlay, not a docked column, so the cart underneath always
  // has the full width — and it only ever shows while there is something to search for.
  const [focused, setFocused] = useState(false);
  // Set while a picked product is waiting to have its quantity confirmed in QuantityModal —
  // every pick goes through it, click or Enter, weighed product or not (see pick() below).
  const [pendingProduct, setPendingProduct] = useState<{ product: ProductSearchResult; initialQty: number | null } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Closing on blur is delayed so a click on a result row (which blurs the input first)
  // still registers before the dropdown disappears out from under the pointer.
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  function handleFocus(): void {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setFocused(true);
  }

  function handleBlur(): void {
    blurTimeoutRef.current = setTimeout(() => setFocused(false), 150);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const parsed = parseQuantityInput(input);
    if (parsed.productText.trim().length === 0) {
      // Nothing typed — nothing to show. No more "browse all products" list docked here;
      // browsing the catalog is Inventory's job, this bar is for finding one thing fast.
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      productsService
        .search(storeId, parsed.productText)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, storeId]);

  // A new list means the old pick points at a different product.
  useEffect(() => {
    setHighlight(-1);
  }, [results]);

  const hasQuery = parseQuantityInput(input).productText.trim().length > 0;
  // With a query, Enter takes the top suggestion unless the cashier arrowed to another.
  const activeRow = highlight >= 0 ? highlight : hasQuery ? 0 : -1;
  const open = focused && hasQuery;

  /** Adds to the bill and resets the bar, once QuantityModal has a confirmed quantity. */
  function commitAdd(product: ProductSearchResult, qty: number): void {
    onAddProduct(product, qty);
    setInput("");
    inputRef.current?.focus();
  }

  // Every pick — click or Enter — opens QuantityModal to confirm the quantity before it
  // touches the bill; nothing is ever added straight from the dropdown.
  function pick(product: ProductSearchResult): void {
    const parsed = parseQuantityInput(input);
    if (product.isWeighted) {
      // An explicit unit in the typed text (e.g. "1.85kg") is what a cashier who already read
      // the scale would type — pre-fill it. A bare number or nothing is too ambiguous for a
      // weighed line to default silently, so the modal starts blank and makes them enter it.
      setPendingProduct({ product, initialQty: parsed.unit !== null ? parsed.qty : null });
    } else {
      // Not weighed: whatever was typed (or 1, if nothing was) is almost always right, so it
      // pre-fills the field — confirming is a single Enter, same speed as the old instant-add.
      setPendingProduct({ product, initialQty: parsed.qty });
    }
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (loading || results.length === 0) return;
      // Otherwise the caret jumps to the start or end of the typed text.
      e.preventDefault();
      const next =
        e.key === "ArrowDown" ? Math.min(results.length - 1, activeRow + 1) : Math.max(0, activeRow - 1);
      setHighlight(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (e.key === "Enter") {
      // Only Enter-to-add when the cashier typed something or deliberately arrowed to a row —
      // with an empty input there is no suggestion list at all, and a stray Enter (or the
      // tail of a failed barcode scan) shouldn't bill it.
      const chosen = activeRow >= 0 ? results[activeRow] : undefined;
      if (chosen && !loading) {
        e.preventDefault();
        pick(chosen);
      }
      return;
    }

    if (e.key === "Escape" && input.length > 0) {
      e.preventDefault();
      setInput("");
    }
  }

  return (
    <div className="search-bar">
      <span className="search-icon" aria-hidden="true">
        <Icon name="billing" />
      </span>
      <input
        id={BILLING_FOCUS_IDS.search}
        ref={inputRef}
        className="search-input"
        placeholder={`Scan barcode or type product (e.g. 2 milk, aachi milagai) — ${billingShortcutLabel("focusSearch")}`}
        aria-label="Search or scan a product"
        autoComplete="off"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {open && (
        <div className="search-dropdown">
          {!loading && results.length > 0 && (
            <div className="search-results-label">Suggestions · ↑↓ to pick, Enter to add</div>
          )}
          {loading && <div className="search-results-label">Searching...</div>}
          <div className="search-results" ref={listRef} role="listbox" aria-label="Products">
            {!loading &&
              results.map((product, index) => (
                <div
                  key={product.productId}
                  data-index={index}
                  role="option"
                  aria-selected={index === activeRow}
                  className={"search-result-row" + (index === activeRow ? " highlighted" : "")}
                  onClick={() => pick(product)}
                >
                  <div>
                    <div className="search-result-name">{product.name}</div>
                    <div className={"search-result-sub" + (product.stockOnHand <= 0 ? " out" : "")}>
                      Stock: {product.stockOnHand} {product.uom}
                      {product.matchType !== "browse" && ` · ${product.matchType}`}
                    </div>
                  </div>
                  <div className="search-result-price">{formatIndianCurrency(product.salePricePaise)}</div>
                </div>
              ))}
            {!loading && results.length === 0 && (
              <div className="search-empty">No matches.</div>
            )}
          </div>
        </div>
      )}
      {pendingProduct && (
        <QuantityModal
          product={pendingProduct.product}
          initialQty={pendingProduct.initialQty}
          onConfirm={(qty) => {
            commitAdd(pendingProduct.product, qty);
            setPendingProduct(null);
          }}
          onCancel={() => {
            setPendingProduct(null);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
