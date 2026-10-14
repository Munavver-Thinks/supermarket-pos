import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ApproverCredentials } from "@pos/types";

import { useT } from "../i18n/useT.js";

import { Icon } from "./icons.js";
import { useModalKeyboard } from "./useModalKeyboard.js";

interface ManagerApprovalDialogProps {
  title: string;
  message: string;
  busy: boolean;
  error: string | null;
  onSubmit: (approver: ApproverCredentials) => void;
  onCancel: () => void;
}

/**
 * Asks a manager or owner standing at the counter to type their username and password. The
 * details live in this component's state only — they are handed to `onSubmit` for the one
 * request being approved and dropped when the dialog closes. The main process checks them.
 */
export function ManagerApprovalDialog({
  title,
  message,
  busy,
  error,
  onSubmit,
  onCancel,
}: ManagerApprovalDialogProps): JSX.Element {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeyboard(formRef);

  useEffect(() => {
    usernameRef.current?.focus();
    return () => {
      // Nothing typed here outlives the dialog.
      setUsername("");
      setPassword("");
    };
  }, []);

  // A refused attempt clears the password so the next try starts clean.
  useEffect(() => {
    if (error) {
      setPassword("");
      passwordRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    // Capture phase, so the screen underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    onSubmit({ username: username.trim(), password });
  }

  return (
    <div className="modal-backdrop modal-stacked">
      <form
        className="modal-card approval-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onSubmit={handleSubmit}
        autoComplete="off"
        ref={formRef}
      >
        <div className="modal-icon info" aria-hidden="true">
          <Icon name="lock" size={28} />
        </div>
        <h2 id="approval-title">{title}</h2>
        <p className="text-muted">{message}</p>
        <div className="field">
          <label htmlFor="approval-username">{t("approval.managerUsername")}</label>
          <input
            id="approval-username"
            ref={usernameRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="approval-password">{t("approval.password")}</label>
          <input
            id="approval-password"
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        {/* A refused attempt's message comes from the main process — left in English, like
            every other server-side message (see uiStrings.ts's documented scope). */}
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>
            {t("approval.cancel")}
          </button>
          <button type="submit" className="primary-btn" disabled={busy || !username.trim() || !password}>
            {busy ? t("approval.checking") : t("approval.approve")}
          </button>
        </div>
      </form>
    </div>
  );
}
