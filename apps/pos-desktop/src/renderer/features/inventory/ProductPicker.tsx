import { useEffect, useRef, useState } from "react";
import type { ProductSearchResult } from "@pos/types";

/** The little a stock form needs to know about the product it is changing. */
export interface PickedProduct {
  productId: string;
  name: string;
  uom: string;
  stockOnHand: number;
}

interface ProductPickerProps {
  storeId: string;
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  label?: string;
}

/**
 * Finds a product by name, barcode, short code or alias — the same search billing uses — and
 * shows its current stock, so nobody has to copy a product id around. Only products that are
 * on sale are found.
 */
export function ProductPicker({ storeId, value, onChange, label = "Product" }: ProductPickerProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  // The query the current results answer, so "no match" isn't shown while a search is pending.
  const [searchedFor, setSearchedFor] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearchedFor("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      window.api.products
        .search(storeId, trimmed)
        .then((found) => setResults(found.slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setSearchedFor(trimmed));
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, storeId]);

  function pick(product: ProductSearchResult): void {
    onChange({
      productId: product.productId,
      name: product.name,
      uom: product.uom,
      stockOnHand: product.stockOnHand,
    });
    setQuery("");
    setResults([]);
  }

  if (value) {
    return (
      <div className="field">
        <label>{label}</label>
        <div className="product-picker-chosen">
          <div>
            <div>{value.name}</div>
            <div className="text-muted">
              In stock: {value.stockOnHand} {value.uom}
            </div>
          </div>
          <button type="button" className="secondary-btn" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field purch-search">
      <label>{label}</label>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, barcode or short code"
      />
      {results.length > 0 && (
        <div className="product-picker-results">
          {results.map((product) => (
            <div key={product.productId} className="product-picker-row" onClick={() => pick(product)}>
              <div>{product.name}</div>
              <div className="product-picker-sub">
                {product.stockOnHand} {product.uom}
              </div>
            </div>
          ))}
        </div>
      )}
      {query.trim().length > 0 && searchedFor === query.trim() && results.length === 0 && (
        <div className="product-picker-hint spaced">
          No matching product on sale.
        </div>
      )}
    </div>
  );
}
