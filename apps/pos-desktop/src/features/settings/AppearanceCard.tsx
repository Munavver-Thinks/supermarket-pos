import { useState } from "react";

import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { useThemeStore } from "@/store/themeStore.js";

import { AppearanceDialog } from "./AppearanceDialog.js";
import { describeThemePreference } from "./ThemeTiles.js";

/**
 * Each signed-in user's own look (colour set, Day/Night/Auto, high contrast). Any active user may
 * change theirs — see ipc/uiSettings.ts. The window itself is AppearanceDialog.
 */
export function AppearanceCard(): JSX.Element {
  const preference = useThemeStore((s) => s.preference);
  const [open, setOpen] = useState(false);

  return (
    <BlueprintCard>
      <h2>Appearance</h2>
      <p className="note settings-note">Your own look — saved for you only.</p>
      <div className="tools-row">
        <span className="appearance-current">{describeThemePreference(preference)}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Change
        </button>
      </div>
      {open && <AppearanceDialog onClose={() => setOpen(false)} />}
    </BlueprintCard>
  );
}
