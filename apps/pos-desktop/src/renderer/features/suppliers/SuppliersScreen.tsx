import { useCallback, useEffect, useState } from "react";
import type { Supplier } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useSessionStore } from "../../store/sessionStore.js";
import type { SupplierInput } from "../../../shared/ipc.js";

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  notes: "",
};

function toInput(form: typeof EMPTY_FORM): SupplierInput {
  return {
    name: form.name.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    gstin: form.gstin.trim().toUpperCase() || null,
    notes: form.notes.trim() || null,
  };
}

export function SuppliersScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);

  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    if (!context) return;
    window.api.suppliers
      .list(context.storeId, showInactive)
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [context, showInactive]);

  useEffect(refresh, [refresh]);

  function startEdit(supplier: Supplier): void {
    setEditingId(supplier.id);
    setMessage(null);
    setForm({
      name: supplier.name,
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      address: supplier.address ?? "",
      gstin: supplier.gstin ?? "",
      notes: supplier.notes ?? "",
    });
  }

  function cancelEdit(): void {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !user) return;
    setSaving(true);
    setMessage(null);

    const input = toInput(form);
    const result = editingId
      ? await window.api.suppliers.update(editingId, input, user.id)
      : await window.api.suppliers.create(context.storeId, input, user.id);

    setSaving(false);

    if (!result.ok) {
      setMessage(result.error ?? "Could not save the supplier.");
      return;
    }

    setMessage(editingId ? "Supplier updated." : "Supplier added.");
    setEditingId(null);
    setForm(EMPTY_FORM);
    refresh();
  }

  async function handleToggleActive(supplier: Supplier): Promise<void> {
    if (!user) return;
    const result = await window.api.suppliers.setActive(supplier.id, !supplier.isActive, user.id);
    if (!result.ok) {
      setMessage(result.error ?? "Could not update the supplier.");
      return;
    }
    if (editingId === supplier.id) cancelEdit();
    refresh();
  }

  return (
    <div className="screen-section">
      <form onSubmit={handleSubmit} className="blueprint">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <h2>{editingId ? "Edit Supplier" : "Add Supplier"}</h2>
        <div className="form-grid-3 sup-grid">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>GSTIN</label>
            <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
          </div>
          <div className="field">
            <label>Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="sup-actions">
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save Changes" : "Add Supplier"}
          </button>
          {editingId && (
            <button className="btn btn-secondary" type="button" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
        {message && <div className="p5b-msg">{message}</div>}
      </form>

      <BlueprintCard>
        <div className="sup-head">
          <h2>Suppliers</h2>
          <label className="p5b-check">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>GSTIN</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers?.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {s.address && <div className="note">{s.address}</div>}
                  </td>
                  <td>{s.phone ?? "—"}</td>
                  <td>{s.gstin ?? "—"}</td>
                  <td>
                    <span className={s.isActive ? "pill ok" : "pill mute"}>{s.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="r p5b-nowrap">
                    <button className="btn btn-ghost" onClick={() => startEdit(s)}>
                      Edit
                    </button>
                    <button
                      className={s.isActive ? "btn btn-ghost p5b-danger-text" : "btn btn-ghost"}
                      onClick={() => void handleToggleActive(s)}
                    >
                      {s.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {suppliers?.length === 0 && (
          <div className="empty-state sup-empty">
            <div className="empty-state-title">No suppliers yet</div>
            Add the shops and distributors you buy stock from — then record what you buy under Purchases.
          </div>
        )}
      </BlueprintCard>
    </div>
  );
}
