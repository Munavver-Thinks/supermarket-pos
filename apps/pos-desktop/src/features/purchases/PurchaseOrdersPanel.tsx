import { useCallback, useEffect, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { PurchaseOrderListRow, PurchaseOrderStatus, Supplier } from "@pos/types";

import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";

import { useAlertsStore } from "../../store/alertsStore.js";
import { useSessionStore } from "../../store/sessionStore.js";

import { PO_STATUS_LABEL, PO_STATUS_PILL, PurchaseOrderEditor } from "./PurchaseOrderEditor.js";
import { purchaseOrdersService } from "./services/purchaseOrdersService.js";

interface PurchaseOrdersPanelProps {
  suppliers: Supplier[];
}

const STATUS_FILTERS: Array<PurchaseOrderStatus | "all"> = [
  "all",
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
  "closed",
];

/** What the shop has asked suppliers for, and what has arrived against it. */
export function PurchaseOrdersPanel({ suppliers }: PurchaseOrdersPanelProps): JSX.Element | null {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const refreshAlerts = useAlertsStore((s) => s.refresh);

  const [filter, setFilter] = useState<PurchaseOrderStatus | "all">("all");
  const [orders, setOrders] = useState<PurchaseOrderListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "new" opens an empty draft; an id opens that order.
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!context || !user) return;
    purchaseOrdersService
      .list({ storeId: context.storeId, actingUserId: user.id, status: filter === "all" ? null : filter, limit: 100 })
      .then((result) => {
        if ("ok" in result) {
          setError(result.error);
          setOrders([]);
          return;
        }
        setError(null);
        setOrders(result);
      })
      .catch(() => setError("Could not load purchase orders."));
  }, [context, user, filter]);

  useEffect(refresh, [refresh]);

  if (!context || !user) return null;

  if (open) {
    return (
      <PurchaseOrderEditor
        key={open}
        poId={open === "new" ? null : open}
        suppliers={suppliers}
        onBack={() => {
          setOpen(null);
          refresh();
        }}
        onChanged={(poId) => {
          // A new draft keeps its editor open under its real id.
          if (open === "new") setOpen(poId);
          refresh();
          void refreshAlerts(context.storeId);
        }}
      />
    );
  }

  return (
    <>
      <div className="tools-row purch-tools">
        <div className="field purch-status-field">
          <label htmlFor="po-status-filter">Status</label>
          <select
            id="po-status-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as PurchaseOrderStatus | "all")}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All" : PO_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="primary-btn purch-new-btn" onClick={() => setOpen("new")}>
          New purchase order
        </button>
      </div>
      <BlueprintCard>
        <h2>Purchase orders</h2>
        {error && <div className="error-text">{error}</div>}
        <div className="table-scroll">
          <table className="table purch-lines">
            <thead>
              <tr>
                <th>PO no.</th>
                <th>Supplier</th>
                <th className="num">Items</th>
                <th className="num">Ordered</th>
                <th className="num">Received</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((po) => (
                <tr key={po.id} className="clickable-row" onClick={() => setOpen(po.id)}>
                  <td>{po.poNo}</td>
                  <td>{po.supplierName}</td>
                  <td className="num">{po.itemCount}</td>
                  <td className="num">{formatIndianCurrency(po.totalPaise)}</td>
                  <td className="num">{po.receivedPaise > 0 ? formatIndianCurrency(po.receivedPaise) : "—"}</td>
                  <td>
                    <span className={`pill ${PO_STATUS_PILL[po.status]}`}>{PO_STATUS_LABEL[po.status]}</span>
                  </td>
                  <td>{new Date(po.createdAt).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
              {orders !== null && orders.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="purch-table-note">
                    No purchase orders{filter === "all" ? " yet" : " with this status"}.
                  </td>
                </tr>
              )}
              {orders === null && (
                <tr>
                  <td colSpan={7} className="purch-table-note">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </BlueprintCard>
    </>
  );
}
