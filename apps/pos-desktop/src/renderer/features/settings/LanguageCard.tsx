import { useState } from "react";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useLoadUiLanguage, useUiLanguageStore } from "../../i18n/useT.js";
import { useSessionStore } from "../../store/sessionStore.js";

/**
 * A display preference, not a store setting — any active signed-in user may change it (see
 * ipc/uiSettings.ts). Covers only the app shell and a handful of dialogs; the rest of the app
 * stays in English regardless of this setting (see uiStrings.ts).
 */
export function LanguageCard(): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const language = useUiLanguageStore((s) => s.language);
  const setLanguage = useUiLanguageStore((s) => s.setLanguage);
  useLoadUiLanguage();
  const [message, setMessage] = useState<string | null>(null);

  async function handleChange(next: "en" | "ta"): Promise<void> {
    if (!user || next === language) return;
    setMessage(null);
    const result = await setLanguage(next, user.id);
    if (!result.ok) setMessage(result.error ?? "Could not save the setting.");
  }

  return (
    <BlueprintCard>
      <h2>Screen language</h2>
      <p className="note settings-note">
        Covers the navigation, screen titles and a few dialogs — not the rest of the app yet, and not receipts (set
        separately above).
      </p>
      <div className="tools-row">
        <button
          className={language === "en" ? "btn btn-secondary" : "btn btn-ghost"}
          onClick={() => void handleChange("en")}
        >
          English
        </button>
        <button
          className={language === "ta" ? "btn btn-secondary" : "btn btn-ghost"}
          onClick={() => void handleChange("ta")}
          lang="ta"
        >
          தமிழ்
        </button>
      </div>
      {message && <div className="error-text">{message}</div>}
    </BlueprintCard>
  );
}
