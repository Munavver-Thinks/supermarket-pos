import { useCallback, useEffect, useRef, useState } from "react";
import { assignableRoles, canManageStaff, canManageStaffMember } from "@pos/business-logic";
import type { User, UserRole } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useConfirm } from "../../components/ConfirmDialog.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { EditEmployeeModal, ResetPasswordModal, ROLE_LABEL } from "./EditEmployeeModal.js";

const EMPTY_FORM = { displayName: "", username: "", password: "", role: "cashier" as UserRole };

export function EmployeesScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const currentUser = useSessionStore((s) => s.user);
  const confirm = useConfirm();
  const confirmingRef = useRef(false);

  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [rowMessage, setRowMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const showAddForm = currentUser ? canManageStaff(currentUser.role) : false;
  const roleOptions = currentUser ? assignableRoles(currentUser.role) : [];

  const refresh = useCallback(() => {
    if (!context) return;
    window.api.users
      .listByStore(context.storeId)
      .then(setUsers)
      .catch(() => undefined);
  }, [context]);

  useEffect(refresh, [refresh]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || !currentUser) return;

    setSaving(true);
    setMessage(null);

    const result = await window.api.users.create({
      storeId: context.storeId,
      actingUserId: currentUser.id,
      username: form.username.trim().toLowerCase(),
      password: form.password,
      displayName: form.displayName.trim(),
      role: form.role,
    });

    setSaving(false);

    if (!result.ok) {
      setMessage(result.error ?? "Could not add the employee.");
      return;
    }

    setMessage(`${result.user?.displayName} can now sign in as ${ROLE_LABEL[form.role].toLowerCase()}.`);
    setForm(EMPTY_FORM);
    refresh();
  }

  async function handleToggleActive(target: User): Promise<void> {
    if (!currentUser) return;
    const verb = target.isActive ? "Deactivate" : "Reactivate";
    if (target.isActive) {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      let ok = false;
      try {
        ok = await confirm({
          title: `Deactivate ${target.displayName}?`,
          message: "They will no longer be able to sign in.",
          cancelLabel: "Keep",
          confirmLabel: "Deactivate",
        });
      } finally {
        confirmingRef.current = false;
      }
      if (!ok) return;
    }
    setBusyId(target.id);
    setRowMessage(null);
    try {
      const result = await window.api.users.setActive({
        userId: target.id,
        actingUserId: currentUser.id,
        isActive: !target.isActive,
      });
      setRowMessage(
        result.ok
          ? `${target.displayName} ${target.isActive ? "can no longer sign in" : "can sign in again"}.`
          : (result.error ?? `Could not ${verb.toLowerCase()} ${target.displayName}.`),
      );
      if (result.ok) refresh();
    } catch {
      setRowMessage("Could not reach the local service.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen-section">
      <div className={showAddForm ? "emp-layout with-form" : "emp-layout"}>
        {showAddForm && (
          <form onSubmit={handleSubmit} className="blueprint">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <h2>Add Employee</h2>
            <div className="field">
              <label>Full name</label>
              <input
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Username</label>
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="lowercase, no spaces"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                required
                type="password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 6 characters"
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </div>
            {currentUser?.role === "manager" && (
              <div className="note emp-note">Owner and manager accounts can only be created by an owner.</div>
            )}
            <button className="primary-btn emp-add-btn" type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add Employee"}
            </button>
            {message && <div className="p5b-msg">{message}</div>}
          </form>
        )}

        <BlueprintCard>
          <h2>Staff</h2>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  {showAddForm && <th className="r">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
                  <tr key={u.id}>
                    <td>{u.displayName}</td>
                    <td>{u.username}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>
                      <span className={u.isActive ? "pill ok" : "pill mute"}>{u.isActive ? "Active" : "Disabled"}</span>
                    </td>
                    {showAddForm && (
                      <td className="r p5b-nowrap">
                        {/* Hidden where the main process would refuse; it re-checks anyway. */}
                        {currentUser && canManageStaffMember(currentUser, u) ? (
                          <span className="emp-btns">
                            <button className="btn btn-ghost" onClick={() => setEditing(u)} disabled={busyId === u.id}>
                              Edit
                            </button>
                            <button
                              className={u.isActive ? "btn btn-ghost p5b-danger-text" : "btn btn-ghost"}
                              onClick={() => void handleToggleActive(u)}
                              disabled={busyId === u.id}
                            >
                              {u.isActive ? "Deactivate" : "Reactivate"}
                            </button>
                            <button
                              className="btn btn-ghost"
                              onClick={() => setResetting(u)}
                              disabled={busyId === u.id}
                            >
                              Reset password
                            </button>
                          </span>
                        ) : (
                          <span className="note">
                            {u.id === currentUser?.id ? "You — change your password in Settings" : "—"}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rowMessage && <div className="p5b-msg">{rowMessage}</div>}
        </BlueprintCard>
      </div>

      {editing && currentUser && (
        <EditEmployeeModal
          employee={editing}
          actor={currentUser}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setRowMessage(`${updated.displayName} saved.`);
            refresh();
          }}
        />
      )}
      {resetting && currentUser && (
        <ResetPasswordModal
          employee={resetting}
          actor={currentUser}
          onClose={() => setResetting(null)}
          onDone={(text) => {
            setResetting(null);
            setRowMessage(text);
          }}
        />
      )}
    </div>
  );
}
