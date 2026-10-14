import { useEffect, useRef, useState } from "react";
import type { Customer } from "@pos/types";

import { customersService } from "@/services/customersService.js";
import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

import type { BillTab } from "../store/cartStore.js";

interface AssignCustomerModalProps {
  storeId: string;
  bills: BillTab[];
  initialIndex: number;
  /** Names of customers already attached, by id, so the bill list can show them. */
  customerNames: Record<string, string>;
  onAssign: (billIndex: number, customer: Customer | null) => void;
  onCancel: () => void;
}

/**
 * Attaches a customer to any open bill — the one waiting while the next customer is served
 * included. Searches the same way the bill's customer box does.
 */
export function AssignCustomerModal({
  storeId,
  bills,
  initialIndex,
  customerNames,
  onAssign,
  onCancel,
}: AssignCustomerModalProps): JSX.Element {
  const [billIndex, setBillIndex] = useState(initialIndex);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    customersService
      .search(storeId, trimmed)
      .then((found) => {
        if (!cancelled) {
          setResults(found);
          setSearchError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSearchError("Could not search customers.");
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, query]);

  const selected = bills[billIndex];
  const currentCustomerId = selected?.cart.customerId ?? null;

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card assign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-customer-title"
        ref={cardRef}
      >
        <h2 id="assign-customer-title">Customer for a bill</h2>
        <div className="field">
          <label htmlFor="assign-customer-bill">Bill</label>
          <select id="assign-customer-bill" value={billIndex} onChange={(e) => setBillIndex(Number(e.target.value))}>
            {bills.map((bill, index) => (
              <option key={bill.cart.clientTxnId} value={index}>
                {bill.label} ({bill.cart.lines.length} items)
                {bill.cart.customerId ? ` — ${customerNames[bill.cart.customerId] ?? "customer attached"}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="assign-customer-search">Customer name or phone</label>
          <input
            id="assign-customer-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="At least 2 letters or digits"
            autoFocus
          />
        </div>
        {searchError && <div className="error-text">{searchError}</div>}
        <div className="assign-results">
          {results.map((customer) => (
            <button
              key={customer.id}
              className="customer-suggestion"
              onClick={() => onAssign(billIndex, customer)}
              disabled={customer.id === currentCustomerId}
            >
              <span>{customer.name}</span>
              <span className="text-muted">{customer.phone ?? "—"}</span>
            </button>
          ))}
          {query.trim().length >= 2 && results.length === 0 && !searchError && (
            <div className="text-muted">
              No customer found. New customers can be added from the bill&rsquo;s customer box.
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          {currentCustomerId && (
            <button className="secondary-btn" onClick={() => onAssign(billIndex, null)}>
              Remove customer from {selected?.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
