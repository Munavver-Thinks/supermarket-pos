import { useEffect, useState } from "react";
import { canChangeStoreSettings } from "@pos/business-logic";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useSessionStore } from "../../store/sessionStore.js";

/** "Block sale of expired stock" — off by default, owner or manager to change. */
export function ExpirySettingsCard(): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    window.api.storeSettings
      .getBlockExpiredSale()
      .then(setEnabled)
      .catch(() => setMessage("Could not load this setting."));
  }, []);

  const canEdit = user ? canChangeStoreSettings(user.role) : false;

  async function handleChange(next: boolean): Promise<void> {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    const result = await window.api.storeSettings.setBlockExpiredSale(next, user.id);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "Could not change this setting.");
      return;
    }
    setEnabled(next);
    setMessage(next ? "Billing now refuses stock that is past its expiry date." : "Expired stock can be billed again.");
  }

  return (
    <BlueprintCard>
      <h2>Expired stock at billing</h2>
      <p className="note settings-note">
        Only stock received with an expiry date is known to be expired. When this is on, a bill that could only be filled
        from expired stock is refused with the item named, until the stock is written off in Inventory.
      </p>
      <label htmlFor="block-expired-sale" className="settings-check">
        <input
          id="block-expired-sale"
          type="checkbox"
          checked={enabled === true}
          disabled={!canEdit || enabled === null || busy}
          onChange={(e) => void handleChange(e.target.checked)}
        />
        <strong>Block sale of expired stock</strong>
      </label>
      {message && <div className="settings-message">{message}</div>}
      {!canEdit && <div className="note settings-foot">Only an owner or manager can change this.</div>}
    </BlueprintCard>
  );
}
