import { useEffect, useId, useRef } from "react";

import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";

import { Icon } from "../Icon/index.js";

import type { ConfirmDialogProps } from "./types.js";

export function ConfirmDialog({ options, resolve }: ConfirmDialogProps): JSX.Element {
  const { title, message, notice, noticeLead, note, confirmLabel, cancelLabel, tone = "danger", width } = options;
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useModalKeyboard(cardRef);

  useEffect(() => {
    // Remember where focus was so it can go back there once the question is answered.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Like a native confirm, the confirm button has focus, so Enter confirms; Escape cancels.
    confirmRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        resolve(false);
      }
    }
    // Capture phase, so the modal or screen underneath never sees the Escape as its own.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [resolve]);

  const hasBody = Boolean(message || notice || note);

  return (
    <div className="modal-backdrop modal-stacked">
      <div
        className="modal-card confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasBody ? bodyId : undefined}
        style={width ? { width } : undefined}
        ref={cardRef}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="confirm-body">
          {notice && (
            <div className="confirm-notice">
              <Icon name="alert" size={20} />
              <span>
                {noticeLead && <b>{noticeLead}</b>}
                {noticeLead && " "}
                {notice}
              </span>
            </div>
          )}
          {message && <div className="confirm-message">{message}</div>}
          {note && <div className="confirm-note">{note}</div>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={() => resolve(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "danger-btn" : "primary-btn"}
            ref={confirmRef}
            onClick={() => resolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
