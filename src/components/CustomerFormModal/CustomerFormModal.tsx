import { useEffect, useRef, useState } from "react";
import type { Customer } from "@pos/types";

import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

interface CustomerFormModalProps {
  title: string;
  submitLabel: string;
  initialName: string;
  initialPhone: string;
  initialAddress: string;
  onSubmit: (values: {
    name: string;
    phone: string | null;
    address: string | null;
  }) => Promise<{ ok: boolean; customer?: Customer; error?: string }>;
  onSuccess: (customer: Customer) => void;
  onCancel: () => void;
}

/**
 * Name, phone and address in one place, shared by the quick "+ Add customer" on the billing
 * screen's customer box and the edit action on the Customers screen — same fields, same
 * validation, only the submit action and initial values differ.
 */
export function CustomerFormModal({
  title,
  submitLabel,
  initialName,
  initialPhone,
  initialAddress,
  onSubmit,
  onSuccess,
  onCancel,
}: CustomerFormModalProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(initialAddress);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    // Capture phase, so the screen underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saving, onCancel]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSubmit({
        name: trimmedName,
        phone: phone.trim() || null,
        address: address.trim() || null,
      });
      if (!result.ok || !result.customer) {
        setError(result.error ?? "Could not save the customer.");
        return;
      }
      onSuccess(result.customer);
    } catch {
      setError("Could not reach the local service. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card customer-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-form-title"
        onSubmit={(e) => void handleSubmit(e)}
        autoComplete="off"
        ref={formRef}
      >
        <h2 id="customer-form-title">{title}</h2>
        <div className="field">
          <label htmlFor="customer-form-name">Name</label>
          <input
            id="customer-form-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="customer-form-phone">Phone</label>
          <input
            id="customer-form-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
            disabled={saving}
          />
        </div>
        <div className="field">
          <label htmlFor="customer-form-address">Address</label>
          <input
            id="customer-form-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Optional"
            disabled={saving}
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={saving || name.trim().length === 0}>
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
