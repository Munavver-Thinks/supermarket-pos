import type { ActivationInfo } from "@pos/types";

import { LogoMark } from "../../components/icons.js";
import { useT } from "../../i18n/useT.js";

import { ActivationForm } from "./ActivationForm.js";

interface ActivationScreenProps {
  activation: ActivationInfo;
  onActivated: (activation: ActivationInfo) => void;
}

/**
 * Shown instead of the login screen while this device is unactivated. Per App.tsx, that is
 * status "unactivated" only — a fresh install of a release that requires activation, with no
 * key stored yet or one that no longer verifies. An existing shop's install
 * ("not_activated_legacy") is never gated and activates from Settings instead; a development
 * run ("developer") is never gated either. See activation.ts for the full state table.
 */
export function ActivationScreen({ activation, onActivated }: ActivationScreenProps): JSX.Element {
  const t = useT();
  return (
    <div className="login-screen">
      <div className="login-card activation-card blueprint">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="activation-title">
          <LogoMark size={44} />
          <h1>{t("activation.heading")}</h1>
        </div>
        <p className="note">{t("activation.intro")}</p>
        <ActivationForm activation={activation} onActivated={onActivated} />
      </div>
    </div>
  );
}
