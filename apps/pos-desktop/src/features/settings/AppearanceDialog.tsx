import { useCallback, useEffect, useRef, useState } from "react";
import type { ThemeMode } from "@pos/business-logic";

import { useModalKeyboard } from "@/hooks/useModalKeyboard.js";
import { useThemeStore } from "@/store/themeStore.js";

import { useSessionStore } from "../../store/sessionStore.js";

import { ThemeTiles } from "./ThemeTiles.js";

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "day", label: "Day" },
  { value: "night", label: "Night" },
  { value: "auto", label: "Auto" },
];

interface AppearanceDialogProps {
  onClose: () => void;
}

/**
 * The Appearance window (wireframe P22). Choices apply live as they are picked; Cancel and Escape
 * put back what was saved when the window opened, Save saves. Per user — see ipc/uiSettings.ts.
 */
export function AppearanceDialog({ onClose }: AppearanceDialogProps): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const draft = useThemeStore((s) => s.preference);
  const preview = useThemeStore((s) => s.preview);
  const setPreference = useThemeStore((s) => s.setPreference);
  const savedRef = useRef(draft);
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalKeyboard(cardRef);

  const cancel = useCallback(() => {
    preview(savedRef.current);
    onClose();
  }, [preview, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  async function done(): Promise<void> {
    if (!user) return;
    const unchanged = JSON.stringify(draft) === JSON.stringify(savedRef.current);
    if (unchanged) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await setPreference(draft, user.id);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the setting.");
      // The failed save put the previous (previewed) look back; keep showing what is picked.
      preview(draft);
      return;
    }
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal-card appearance-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        ref={cardRef}
      >
        <div className="appearance-title-row">
          <h2 id="appearance-title">Appearance</h2>
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Close
          </button>
        </div>

        <div className="appearance-kicker">Colour set</div>
        <ThemeTiles value={draft} onSelect={(choice) => preview({ ...draft, set: choice.set, mode: choice.mode })} />

        <div className="appearance-options">
          <div className="appearance-field">
            <div className="appearance-label" id="appearance-mode-label">
              When to use Night
            </div>
            <div className="appearance-segmented" role="radiogroup" aria-labelledby="appearance-mode-label">
              {MODES.map((mode) => (
                <label key={mode.value} className={draft.mode === mode.value ? "selected" : undefined}>
                  <input
                    type="radio"
                    name="appearance-mode"
                    checked={draft.mode === mode.value}
                    onChange={() => preview({ ...draft, mode: mode.value })}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
            <span className="appearance-note">Auto: Night from 7:00 pm to 7:00 am.</span>
          </div>

          <div className="appearance-field">
            <div className="appearance-label">Accessibility</div>
            <label className="appearance-switch">
              <input
                type="checkbox"
                role="switch"
                checked={draft.highContrast}
                onChange={(e) => preview({ ...draft, highContrast: e.target.checked })}
              />
              <span>High contrast (black on white, for low vision or bright sunlight)</span>
            </label>
            <span className="appearance-note">Turns off the colour set while on.</span>
          </div>
        </div>

        <div className="appearance-saved-note">
          <b>Saved for {user?.displayName ?? "you"} only.</b> Each person signs in to their own look; the customer
          display and printed receipts never change.
        </div>

        {error && <div className="error-text">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn primary-btn" onClick={() => void done()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
