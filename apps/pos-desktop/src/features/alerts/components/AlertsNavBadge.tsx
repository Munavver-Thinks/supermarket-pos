import { useAlertsStore } from "@/store/alertsStore.js";

/** Count of open stock alerts, shown on the Notifications nav item. Nothing when there are none. */
export function AlertsNavBadge(): JSX.Element | null {
  const count = useAlertsStore((s) => s.alerts.length);
  if (count === 0) return null;
  return (
    <span className="nav-badge" aria-label={`${count} alerts`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
