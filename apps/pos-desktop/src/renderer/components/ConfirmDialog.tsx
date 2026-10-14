import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "./icons.js";
import { useModalKeyboard } from "./useModalKeyboard.js";

export interface ConfirmOptions {
  title: string;
  /** Body text; newlines and bullets are kept as written. */
  message?: string;
  /** Orange notice with an alert icon (the thing that will be lost or replaced). */
  notice?: string;
  /** Shown in bold at the start of the notice (e.g. the backup's name). */
  noticeLead?: string;
  /** Small muted line under the body. */
  note?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** "danger" (default) paints the confirm button tomato; "primary" is the normal button. */
  tone?: "danger" | "primary";
  width?: number;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/** The text after a helper's first line — used where the first line becomes the dialog title. */
export function afterFirstLine(text: string): string {
  const at = text.indexOf("\n");
  return at === -1 ? text : text.slice(at + 1);
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending {
  /** Fresh per question, so a queued one remounts (and refocuses) rather than reusing the last. */
  key: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/**
 * Themed replacement for the browser's native confirm box. One dialog at a time: a call made while another is
 * open waits its turn (promise chain), so every caller still gets its own answer.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const nextKey = useRef(0);

  const confirm = useCallback<ConfirmFn>((options) => {
    const run = (): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        nextKey.current += 1;
        setPending({
          key: nextKey.current,
          options,
          resolve: (ok) => {
            setPending(null);
            resolve(ok);
          },
        });
      });
    const result = tail.current.then(run);
    tail.current = result;
    return result;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog key={pending.key} options={pending.options} resolve={pending.resolve} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

function ConfirmDialog({ options, resolve }: Omit<Pending, "key">): JSX.Element {
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
