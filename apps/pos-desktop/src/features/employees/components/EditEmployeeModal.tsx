import { useEffect, useRef, useState } from "react";
import { assignableRoles } from "@pos/business-logic";
import type { User, UserRole } from "@pos/types";

import { usersService } from "@/services/usersService.js";
import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

import { ROLE_LABEL } from "../constants.js";

interface EditEmployeeModalProps {
  employee: User;
  actor: User;
  onSaved: (updated: User) => void;
  onClose: () => void;
}

/** Rename an employee or change their role. The main process re-checks every rule. */
export function EditEmployeeModal({ employee, actor, onSaved, onClose }: EditEmployeeModalProps): JSX.Element {
  const [displayName, setDisplayName] = useState(employee.displayName);
  const [role, setRole] = useState<UserRole>(employee.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

  // The employee's current role stays selectable even when the actor couldn't hand it out,
  // so opening the dialog never silently changes it.
  const options = [...new Set<UserRole>([employee.role, ...assignableRoles(actor.role)])];

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await usersService.update({
        userId: employee.id,
        actingUserId: actor.id,
        displayName: displayName.trim(),
        role,
      });
      if (!result.ok || !result.user) {
        setError(result.error ?? "Could not save the changes.");
        return;
      }
      onSaved(result.user);
    } catch {
      setError("Could not reach the local service.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card edit-employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-employee-title"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <h2 id="edit-employee-title">Edit {employee.displayName}</h2>
        <p className="popup-note">
          Username <strong>{employee.username}</strong> can&rsquo;t be changed.
        </p>
        <div className="field">
          <label htmlFor="edit-employee-name">Full name</label>
          <input
            id="edit-employee-name"
            required
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="edit-employee-role">Role</label>
          <select id="edit-employee-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {options.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={saving || !displayName.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ResetPasswordModalProps {
  employee: User;
  actor: User;
  onDone: (message: string) => void;
  onClose: () => void;
}

/** Sets a new password for an employee who forgot theirs; the actor tells them what it is. */
export function ResetPasswordModal({ employee, actor, onDone, onClose }: ResetPasswordModalProps): JSX.Element {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await usersService.resetPassword({
        userId: employee.id,
        actingUserId: actor.id,
        newPassword: password,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not reset the password.");
        return;
      }
      onDone(`${employee.displayName}'s password was reset. Tell them the new one in person.`);
    } catch {
      setError("Could not reach the local service.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal-card edit-employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-pw-title"
        onSubmit={handleSubmit}
        autoComplete="off"
        ref={formRef}
      >
        <h2 id="reset-pw-title">Reset password — {employee.displayName}</h2>
        <div className="field">
          <label htmlFor="reset-pw-new">New password</label>
          <input
            id="reset-pw-new"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters, not the username"
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="reset-pw-confirm">Type it again</label>
          <input
            id="reset-pw-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={saving || password.length < 6}>
            {saving ? "Saving…" : "Reset password"}
          </button>
        </div>
      </form>
    </div>
  );
}
