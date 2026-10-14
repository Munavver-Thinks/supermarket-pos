import { useEffect } from "react";
import { alertsSignature, summarizeAlerts } from "@pos/business-logic";

import { Icon } from "../../components/icons.js";
import { useAlertsStore } from "../../store/alertsStore.js";
import { useSessionStore } from "../../store/sessionStore.js";

/** How often the shell re-checks stock while nothing else has triggered a refresh. */
const REFRESH_MS = 5 * 60_000;

interface AlertsBannerProps {
  /** Keeps the refresh running while the strip itself isn't wanted (on the alerts screen). */
  hidden: boolean;
  onView: () => void;
}

/**
 * App-wide strip naming how many items need attention. Also owns the background refresh:
 * once on sign-in (this mounts with the signed-in shell) and every few minutes after.
 * Dismissing hides it until the set of alerts changes.
 */
export function AlertsBanner({ hidden, onView }: AlertsBannerProps): JSX.Element | null {
  const context = useSessionStore((s) => s.context);
  const alerts = useAlertsStore((s) => s.alerts);
  const loaded = useAlertsStore((s) => s.loaded);
  const lastSeen = useAlertsStore((s) => s.lastSeenSignature);
  const refresh = useAlertsStore((s) => s.refresh);
  const markSeen = useAlertsStore((s) => s.markSeen);

  useEffect(() => {
    if (!context) return;
    const storeId = context.storeId;
    void refresh(storeId);
    const timer = setInterval(() => void refresh(storeId), REFRESH_MS);
    return () => clearInterval(timer);
  }, [context, refresh]);

  if (hidden || !loaded || alerts.length === 0 || alertsSignature(alerts) === lastSeen) return null;

  return (
    <div className="status-banner alerts-banner" role="status">
      <Icon name="bell" />
      <span>{summarizeAlerts(alerts)}</span>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          markSeen();
          onView();
        }}
      >
        View
      </button>
      <button type="button" className="btn btn-ghost" onClick={markSeen}>
        Dismiss
      </button>
    </div>
  );
}
