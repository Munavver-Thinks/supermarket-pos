import { useEffect } from "react";
import type { StockAlert, StockAlertKind, UserRole } from "@pos/types";

import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { useAlertsStore } from "@/store/alertsStore.js";
import { useSessionStore } from "@/store/sessionStore.js";

interface AlertsScreenProps {
  onGoInventory: () => void;
  onGoPurchases: () => void;
}

const GROUPS: Array<{ kind: StockAlertKind; title: string; tone: "bad" | "warn" }> = [
  { kind: "out_of_stock", title: "Out of stock", tone: "bad" },
  { kind: "expired", title: "Past expiry", tone: "bad" },
  { kind: "low_stock", title: "Low stock", tone: "warn" },
  { kind: "expiring", title: "Expiring soon", tone: "warn" },
];

/** Screens these buttons lead to are only in the nav for these roles. */
const STOCK_ROLES: UserRole[] = ["owner", "manager", "inventory_staff"];

/**
 * Everything on the shelf that needs attention. The buttons only navigate — reordering and
 * writing off happen on those screens.
 */
export function AlertsScreen({ onGoInventory, onGoPurchases }: AlertsScreenProps): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const alerts = useAlertsStore((s) => s.alerts);
  const loaded = useAlertsStore((s) => s.loaded);
  const refresh = useAlertsStore((s) => s.refresh);
  const markSeen = useAlertsStore((s) => s.markSeen);

  useEffect(() => {
    if (!context) return;
    // Opening this screen counts as having seen the alerts, so the banner goes away.
    void refresh(context.storeId).then(markSeen);
  }, [context, refresh, markSeen]);

  const canActOnStock = user ? STOCK_ROLES.includes(user.role) : false;
  const byKind = (kind: StockAlertKind): StockAlert[] => alerts.filter((a) => a.kind === kind);

  return (
    <div className="screen-section">
      {canActOnStock && (
        <div className="tools-row">
          <button type="button" className="btn btn-secondary" onClick={onGoInventory}>
            Go to Inventory
          </button>
          <button type="button" className="btn btn-secondary" onClick={onGoPurchases}>
            Go to Purchases
          </button>
        </div>
      )}

      {!loaded && <div className="note">Loading…</div>}
      {loaded && alerts.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-title">Nothing needs attention</div>
          No product is out of stock or at its reorder level, and no dated stock is expiring soon.
        </div>
      )}

      <div className="notif-grid">
        {GROUPS.map(({ kind, title, tone }) => {
          const rows = byKind(kind);
          if (rows.length === 0) return null;
          return (
            <BlueprintCard key={kind}>
              <h2>
                <span className={"pill " + tone}>{rows.length}</span> {title}
              </h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.key}>
                      <td>{a.name}</td>
                      <td>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </BlueprintCard>
          );
        })}
      </div>
    </div>
  );
}
