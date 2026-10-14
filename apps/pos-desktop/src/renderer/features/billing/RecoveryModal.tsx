import { useEffect, useRef } from "react";
import type { DraftBill } from "@pos/types";

import { Icon } from "../../components/icons.js";
import { useModalKeyboard } from "../../components/useModalKeyboard.js";

import { ShortcutKey } from "./ShortcutHelpOverlay.js";

interface RecoveryModalProps {
  drafts: DraftBill[];
  onRestore: (draft: DraftBill) => void;
  onDiscard: (draft: DraftBill) => void;
  onClose: () => void;
}

export function RecoveryModal({ drafts, onRestore, onDiscard, onClose }: RecoveryModalProps): JSX.Element {
  const firstRestoreRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useModalKeyboard(cardRef);

  // Focus the top Restore so Enter brings bills back one by one; re-run as the list shrinks,
  // because the button that had focus has just been removed.
  useEffect(() => {
    firstRestoreRef.current?.focus();
  }, [drafts.length]);

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card recovery-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        ref={cardRef}
      >
        <h2 id="recovery-title">Unfinished bills found</h2>
        <p className="recovery-note">
          <Icon name="info" size={20} />
          <span>
            The app may have closed unexpectedly. These bills were saved automatically — restore the ones you want to
            continue.
          </span>
        </p>
        <ul className="recovery-list">
          {drafts.map((draft, index) => (
            <li key={draft.clientTxnId}>
              <div>
                <div className="recovery-name">{draft.label ?? "Unnamed bill"}</div>
                <div className="text-muted">
                  {draft.cart.lines.length} item(s) · saved {new Date(draft.updatedAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="recovery-item-actions">
                <button className="secondary-btn" onClick={() => onDiscard(draft)}>
                  Discard
                </button>
                <button
                  ref={index === 0 ? firstRestoreRef : undefined}
                  className="primary-btn"
                  onClick={() => onRestore(draft)}
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>
            Close <ShortcutKey action="closeRecovery" />
          </button>
        </div>
      </div>
    </div>
  );
}
