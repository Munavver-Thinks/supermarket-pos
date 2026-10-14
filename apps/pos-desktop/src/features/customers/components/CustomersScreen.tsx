import { useCallback, useEffect, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { Customer, CustomerBalance } from "@pos/types";

import { creditService } from "@/services/creditService.js";
import { customersService } from "@/services/customersService.js";
import { BlueprintCard } from "@/components/BlueprintCard/BlueprintCard.js";
import { Icon } from "@/components/Icon/index.js";
import { CustomerFormModal } from "@/components/CustomerFormModal/CustomerFormModal.js";
import { useSessionStore } from "@/store/sessionStore.js";

import type { KhataTarget } from "../types.js";

import { KhataDrawer } from "./KhataDrawer.js";

/** Owed to the shop is red, an advance is green (colour only; the amount text is unchanged). */
function balanceClass(paise: number): string | undefined {
  if (paise > 0) return "cust-due";
  if (paise < 0) return "cust-advance";
  return undefined;
}

export function CustomersScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [outstanding, setOutstanding] = useState<CustomerBalance[]>([]);
  const [openCustomer, setOpenCustomer] = useState<KhataTarget | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const refreshOutstanding = useCallback(() => {
    if (!context) return;
    creditService.listOutstanding(context.storeId).then(setOutstanding).catch(() => undefined);
  }, [context]);

  useEffect(refreshOutstanding, [refreshOutstanding]);

  const refreshCustomers = useCallback(() => {
    if (!context) return;
    const trimmed = query.trim();
    const request = trimmed
      ? customersService.search(context.storeId, trimmed)
      : customersService.listRecent(context.storeId, 50);
    request.then(setCustomers).catch(() => undefined);
  }, [context, query]);

  useEffect(refreshCustomers, [refreshCustomers]);

  const balanceByCustomer = new Map(outstanding.map((o) => [o.customerId, o.balancePaise]));
  const totalDuePaise = outstanding.reduce((sum, o) => sum + Math.max(0, o.balancePaise), 0);

  return (
    <div className="screen-section">
      {outstanding.length > 0 && (
        <BlueprintCard>
          <div className="card-kicker">Khata · money owed to the shop</div>
          <div className="kpi-value">{formatIndianCurrency(totalDuePaise)}</div>
          <div className="kpi-delta">
            across {outstanding.length} {outstanding.length === 1 ? "customer" : "customers"}
          </div>

          <div className="table-scroll cust-owed">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Last activity</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((o) => (
                  <tr key={o.customerId}>
                    <td>
                      <button
                        className="link-btn"
                        onClick={() =>
                          setOpenCustomer({
                            id: o.customerId,
                            name: o.name,
                            phone: o.phone,
                            creditLimitPaise: o.creditLimitPaise,
                          })
                        }
                      >
                        {o.name}
                      </button>
                    </td>
                    <td>{o.phone ?? "—"}</td>
                    <td className="text-muted">
                      {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="num">
                      <b className={balanceClass(o.balancePaise)}>{formatIndianCurrency(o.balancePaise)}</b>
                      {o.creditLimitPaise > 0 && <div className="note">limit {formatIndianCurrency(o.creditLimitPaise)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BlueprintCard>
      )}

      <div className="tools-row">
        <div className="p5b-search cust-search">
          <Icon name="search" size={20} />
          <input
            className="input"
            placeholder="Search name or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <BlueprintCard>
        <h2>Customers</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th className="num">Khata</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers?.map((c) => {
                const balance = balanceByCustomer.get(c.id) ?? 0;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.address ?? "—"}</td>
                    <td className="num">
                      {balance === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <b className={balanceClass(balance)}>{formatIndianCurrency(balance)}</b>
                      )}
                    </td>
                    <td className="r p5b-nowrap">
                      <button className="btn btn-ghost" onClick={() => setEditingCustomer(c)}>
                        Edit
                      </button>{" "}
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          setOpenCustomer({
                            id: c.id,
                            name: c.name,
                            phone: c.phone,
                            creditLimitPaise: c.creditLimitPaise,
                          })
                        }
                      >
                        Khata
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {customers?.length === 0 && (
          <div className="empty-state cust-empty">
            <div className="empty-state-title">No customers found</div>
            Customers are added from the Billing screen while attaching a bill.
          </div>
        )}
      </BlueprintCard>

      {openCustomer && (
        <KhataDrawer
          customer={openCustomer}
          onClose={() => setOpenCustomer(null)}
          onChanged={() => {
            refreshOutstanding();
            // A changed credit limit shows up in the list too.
            refreshCustomers();
          }}
        />
      )}

      {editingCustomer && user && (
        <CustomerFormModal
          title={`Edit ${editingCustomer.name}`}
          submitLabel="Save changes"
          initialName={editingCustomer.name}
          initialPhone={editingCustomer.phone ?? ""}
          initialAddress={editingCustomer.address ?? ""}
          onSubmit={(values) => customersService.update(editingCustomer.id, values, user.id)}
          onSuccess={() => {
            setEditingCustomer(null);
            refreshCustomers();
            refreshOutstanding();
          }}
          onCancel={() => setEditingCustomer(null)}
        />
      )}
    </div>
  );
}
