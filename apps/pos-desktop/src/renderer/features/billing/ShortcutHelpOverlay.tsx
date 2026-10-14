import { useEffect, useRef } from "react";
import { BILLING_SHORTCUTS, billingShortcutLabel } from "@pos/business-logic";
import type { BillingShortcutAction, BillingShortcutBinding } from "@pos/business-logic";

import { useModalKeyboard } from "../../components/useModalKeyboard.js";

/** The key for an action, drawn as a keycap — used on buttons so shortcuts are discoverable. */
export function ShortcutKey({ action }: { action: BillingShortcutAction }): JSX.Element {
  return <kbd className="kbd">{billingShortcutLabel(action)}</kbd>;
}

const SECTIONS: { title: string; layers: BillingShortcutBinding["layer"][] }[] = [
  { title: "On the bill", layers: ["screen"] },
  { title: "In the payment window", layers: ["payment"] },
  { title: "Anywhere on billing", layers: ["any", "recovery", "help"] },
];

/** Feature 2's Tab-trap + arrow-key navigation convention (useModalKeyboard.ts), common to
 * every modal in the app — not generated from BILLING_SHORTCUTS since it isn't a billing
 * shortcut binding, so it's listed here as its own static section. */
const ANY_WINDOW_ROWS: { label: string; description: string }[] = [
  { label: "↑ / ↓", description: "Next / previous box or button" },
  { label: "← / →", description: "Next / previous button (in a text box they move the cursor)" },
  { label: "Tab", description: "Moves between boxes without leaving the window" },
];

export function ShortcutHelpOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // This overlay has no real inputs, only a scrollable list and a Close button — arrow keys
  // must keep scrolling the list natively, so arrowNav is off. It still gets the Tab trap.
  useModalKeyboard(cardRef, { arrowNav: false });

  // Hand focus back to wherever the cashier was, so checking a key doesn't lose their place.
  // Separate from, and untouched by, useModalKeyboard's own (unrelated) focus handling.
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        ref={cardRef}
      >
        <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
        <p className="text-muted">Function keys work from any box without typing into it.</p>
        <div className="shortcut-help-columns">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl className="shortcut-help-list">
                {BILLING_SHORTCUTS.filter((b) => section.layers.includes(b.layer)).map((b) => (
                  <div key={`${b.layer}:${b.label}`} className="shortcut-help-row">
                    <dt>
                      <kbd className="kbd">{b.label}</kbd>
                    </dt>
                    <dd>{b.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section>
            <h3>In any window</h3>
            <dl className="shortcut-help-list">
              {ANY_WINDOW_ROWS.map((row) => (
                <div key={row.label} className="shortcut-help-row">
                  <dt>
                    <kbd className="kbd">{row.label}</kbd>
                  </dt>
                  <dd>{row.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <div className="modal-actions">
          <button ref={closeRef} className="secondary-btn" onClick={onClose}>
            Close <ShortcutKey action="closeHelp" />
          </button>
        </div>
      </div>
    </div>
  );
}
