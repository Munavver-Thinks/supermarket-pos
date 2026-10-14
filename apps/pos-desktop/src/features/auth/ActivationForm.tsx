import { useState } from "react";
import type { ActivationInfo } from "@pos/types";

import { Icon } from "@/components/Icon/index.js";
import { useT } from "@/hooks/useT.js";

import { activationService } from "./services/activationService.js";

interface ActivationFormProps {
  activation: ActivationInfo;
  onActivated: (activation: ActivationInfo) => void;
}

/**
 * The request code + key box, shared by the full-screen gate (ActivationScreen, for a fresh
 * install that requires activation) and the Settings Device card (for an existing install
 * that can activate whenever the owner is ready). A key that fails changes nothing here —
 * `activation` itself is unchanged, so `activation.reason` keeps showing why.
 */
export function ActivationForm({ activation, onActivated }: ActivationFormProps): JSX.Element {
  const t = useT();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(activation.requestCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the OS; the code is still plain selectable text.
    }
  }

  async function handleActivate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await activationService.activate(key);
      if (result.ok && result.activation) {
        setKey("");
        onActivated(result.activation);
      } else {
        setError(result.error ?? t("activation.genericError"));
      }
    } catch {
      setError(t("activation.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="activation-form">
      <div className="field">
        <label>{t("activation.requestCode")}</label>
        <div className="activation-code-row">
          <code className="activation-code">{activation.requestCode}</code>
          <button type="button" className="btn btn-ghost" onClick={() => void handleCopy()}>
            {copied ? t("activation.copied") : t("activation.copy")}
          </button>
        </div>
        <div className="note">{t("activation.giveCode")}</div>
      </div>

      {/* A stored key's rejection reason comes from the main process — left in English, like
          every other server-side message (see uiStrings.ts's documented scope). */}
      {activation.reason && (
        <div className="error-text">
          <Icon name="alert" size={24} />
          <span>{activation.reason}</span>
        </div>
      )}

      <form className="activation-form" onSubmit={(e) => void handleActivate(e)}>
        <div className="field">
          <label htmlFor="activation-key">{t("activation.keyLabel")}</label>
          <textarea
            id="activation-key"
            rows={3}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("activation.keyPlaceholder")}
          />
        </div>
        {error && (
          <div className="error-text">
            <Icon name="alert" size={24} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary-btn login-submit" type="submit" disabled={busy || !key.trim()}>
          {busy ? t("activation.activating") : t("activation.activate")}
        </button>
      </form>
    </div>
  );
}
