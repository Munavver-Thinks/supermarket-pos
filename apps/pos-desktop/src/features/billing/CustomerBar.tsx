import { useEffect, useRef, useState } from "react";
import { billingShortcutLabel, formatIndianCurrency } from "@pos/business-logic";
import type { Customer } from "@pos/types";

import { customersService } from "@/services/customersService.js";
import { CustomerFormModal } from "@/components/CustomerFormModal/CustomerFormModal.js";

import { useSessionStore } from "../../store/sessionStore.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";
import { BILLING_FOCUS_IDS, focusById } from "./useBillingShortcuts.js";

interface CustomerBarProps {
  storeId: string;
  customer: Customer | null;
  balancePaise: number;
  onAttach: (customer: Customer) => void;
  onClear: () => void;
}

/**
 * Puts a name on the bill. Walk-in trade is the default and stays one keystroke away —
 * this only has to be used when it matters, which in practice means credit, since a khata
 * entry is meaningless without someone to attach it to.
 */
export function CustomerBar({ storeId, customer, balancePaise, onAttach, onClear }: CustomerBarProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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
        if (!cancelled) setResults(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeId, query]);

  // Clicking anywhere else should dismiss the suggestions rather than leave them hanging
  // over the cart.
  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function attach(found: Customer): void {
    onAttach(found);
    setQuery("");
    setResults([]);
    setOpen(false);
    // The customer is on the bill; the next job is scanning.
    focusById(BILLING_FOCUS_IDS.search);
  }

  // A bare number typed into the box is almost always a phone, not a name — pre-fill
  // whichever field it looks like, but always ask, so a new customer never gets stuck with
  // just a phone number for a name (or no phone at all because a real name was typed).
  const trimmedQuery = query.trim();
  const queryLooksLikePhone = /^\d{6,}$/.test(trimmedQuery);
  const createInitialName = queryLooksLikePhone ? "" : trimmedQuery;
  const createInitialPhone = queryLooksLikePhone ? trimmedQuery : "";

  // Arrow keys walk from the input down through the suggestions and back; Esc gives up and
  // returns to product search. Enter on a suggestion is the button's own click.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setOpen(false);
      focusById(BILLING_FOCUS_IDS.search);
      return;
    }
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      const first = results[0];
      if (first && query.trim().length >= 2) {
        e.preventDefault();
        attach(first);
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const box = boxRef.current;
    if (!box) return;
    const items = Array.from(box.querySelectorAll<HTMLElement>("input, .customer-suggestion:not(:disabled)"));
    const at = items.findIndex((item) => item === document.activeElement);
    const next = at < 0 ? undefined : items[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  if (customer) {
    return (
      <div className="customer-bar">
        <span className="customer-label">
          Customer <ShortcutKey action="focusCustomer" />
        </span>
        <span className="customer-chip">
          <strong>{customer.name}</strong>
          {customer.phone && <span> · {customer.phone}</span>}
        </span>
        {balancePaise > 0 && (
          <span className="customer-due">Khata due {formatIndianCurrency(balancePaise)}</span>
        )}
        {/* Takes the customer shortcut's focus while attached, so F3 then Enter swaps customers. */}
        <button id={BILLING_FOCUS_IDS.customer} className="btn btn-ghost" onClick={onClear}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="customer-bar" ref={boxRef}>
      <span className="customer-label">Walk-in customer</span>
      <div
        className="customer-search"
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          // Focus leaving the box by keyboard (Tab, F2) should close the list, as a click outside does.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <input
          id={BILLING_FOCUS_IDS.customer}
          className="input"
          placeholder={`Attach customer — name or phone (${billingShortcutLabel("focusCustomer")})`}
          aria-label="Attach customer by name or phone"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {open && query.trim().length >= 2 && (
          <div className="customer-suggestions">
            {results.map((r) => (
              <button key={r.id} className="customer-suggestion" onClick={() => attach(r)}>
                <span>{r.name}</span>
                <span className="text-muted">{r.phone ?? "—"}</span>
              </button>
            ))}
            <button className="customer-suggestion new" onClick={() => setShowCreate(true)}>
              {`+ Add "${query.trim()}" as a new customer`}
            </button>
          </div>
        )}
      </div>
      {showCreate && user && (
        <CustomerFormModal
          title="New customer"
          submitLabel="Add customer"
          initialName={createInitialName}
          initialPhone={createInitialPhone}
          initialAddress=""
          onSubmit={(values) => customersService.create(storeId, values, user.id)}
          onSuccess={(created) => {
            setShowCreate(false);
            attach(created);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
