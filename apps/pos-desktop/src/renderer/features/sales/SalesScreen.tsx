import { useEffect, useState } from "react";
import { formatIndianCurrency } from "@pos/business-logic";
import type { RecentSale } from "@pos/types";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { Icon } from "../../components/icons.js";
import { useSessionStore } from "../../store/sessionStore.js";
import type { SalePrintResponse } from "../../../shared/ipc.js";

const RECENT_LIMIT = 50;

type PrintKind = "receipt" | "a4" | "pdf";

/** A bill found by its number that isn't in the recent list; only what the lookup returns. */
interface FoundBill {
  id: string;
  billNo: string;
  createdAt: string;
  customerName: string | null;
  netPaise: number;
}

export function SalesScreen(): JSX.Element {
  const context = useSessionStore((s) => s.context);
  const user = useSessionStore((s) => s.user);
  const [sales, setSales] = useState<RecentSale[] | null>(null);
  const [filter, setFilter] = useState("");
  const [found, setFound] = useState<FoundBill | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ saleId: string; kind: PrintKind } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!context) return;
    window.api.sales.listRecent(context.storeId, RECENT_LIMIT).then(setSales).catch(() => undefined);
  }, [context]);

  const needle = filter.trim().toLowerCase();
  const visible = sales?.filter((s) => needle === "" || s.billNo.toLowerCase().includes(needle)) ?? null;

  // Older bills aren't in the recent list, so an exact bill number is looked up directly.
  async function handleFind(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!context || needle === "") return;
    setFound(null);
    setLookupMessage(null);
    try {
      const bill = await window.api.returns.lookup(context.storeId, filter.trim());
      if (!bill) {
        setLookupMessage("No completed bill with that exact number.");
        return;
      }
      if (sales?.some((s) => s.id === bill.saleId)) return; // already listed below
      setFound({
        id: bill.saleId,
        billNo: bill.billNo,
        createdAt: bill.createdAt,
        customerName: bill.customerName,
        netPaise: bill.netPaise,
      });
    } catch {
      setLookupMessage("Could not reach the local service.");
    }
  }

  async function handlePrint(sale: { id: string; billNo: string }, kind: PrintKind): Promise<void> {
    if (!user || busy) return;
    setBusy({ saleId: sale.id, kind });
    setMessage(null);
    try {
      let result: SalePrintResponse;
      if (kind === "receipt") result = await window.api.printer.printReceipt(sale.id, user.id);
      else if (kind === "a4") result = await window.api.printer.printInvoiceA4(sale.id, user.id);
      else result = await window.api.printer.saveInvoicePdf(sale.id, user.id);

      if (!result.ok) {
        setMessage({ text: `${sale.billNo}: ${result.error ?? "Could not print."}`, error: true });
        return;
      }
      const copy = result.duplicate ? " (marked DUPLICATE COPY)" : "";
      const done =
        kind === "receipt"
          ? `Receipt for ${sale.billNo} sent to the printer${copy}.`
          : kind === "a4"
            ? `A4 invoice for ${sale.billNo} sent to the printer${copy}.`
            : `Invoice ${sale.billNo} saved to ${result.path ?? "the chosen file"}${copy}.`;
      setMessage({ text: done, error: false });
    } catch {
      setMessage({ text: "Could not reach the local service.", error: true });
    } finally {
      setBusy(null);
    }
  }

  function printButtons(sale: { id: string; billNo: string }): JSX.Element {
    const isBusy = (kind: PrintKind) => busy?.saleId === sale.id && busy.kind === kind;
    return (
      <span className="sal-print-btns">
        <button className="btn btn-secondary" disabled={busy !== null} onClick={() => void handlePrint(sale, "receipt")}>
          <Icon name="printer" size={16} />
          {isBusy("receipt") ? "Printing…" : "Reprint"}
        </button>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void handlePrint(sale, "a4")}>
          {isBusy("a4") ? "Opening…" : "Print A4"}
        </button>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void handlePrint(sale, "pdf")}>
          {isBusy("pdf") ? "Saving…" : "Save PDF"}
        </button>
      </span>
    );
  }

  return (
    <div className="screen-section">
      <form onSubmit={handleFind} className="tools-row sal-find">
        <div className="field sal-find-field">
          <label htmlFor="sales-bill-filter">Bill number</label>
          <input
            id="sales-bill-filter"
            value={filter}
            placeholder="POS-20261005-12"
            onChange={(e) => {
              setFilter(e.target.value);
              setFound(null);
              setLookupMessage(null);
            }}
          />
        </div>
        <button className="btn btn-secondary" type="submit" disabled={needle === ""}>
          Find older bill
        </button>
        <span className="note sal-hint">
          Typing filters the last {RECENT_LIMIT} bills; Find looks up any bill by its exact number.
        </span>
      </form>
      <div className="sal-notes">
        {lookupMessage && <div className="error-text">{lookupMessage}</div>}
        {message && <div className={message.error ? "error-text" : "p5b-msg"}>{message.text}</div>}
        <div className="note">
          The first print of a bill is the original; every later copy is marked DUPLICATE COPY and recorded in the
          activity log.
        </div>
      </div>

      {found && (
        <BlueprintCard>
          <h4>Found</h4>
          <table className="table">
            <tbody>
              <tr>
                <td>{found.billNo}</td>
                <td>{new Date(found.createdAt).toLocaleString()}</td>
                <td>{found.customerName ?? "Walk-in"}</td>
                <td className="num">{formatIndianCurrency(found.netPaise)}</td>
                <td className="r p5b-nowrap">{printButtons(found)}</td>
              </tr>
            </tbody>
          </table>
        </BlueprintCard>
      )}

      <BlueprintCard>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Time</th>
                <th>Cashier</th>
                <th>Customer</th>
                <th className="num">Items</th>
                <th className="num">Amount</th>
                <th className="r">Print</th>
              </tr>
            </thead>
            <tbody>
              {visible?.map((s) => (
                <tr key={s.id}>
                  <td>{s.billNo}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>{s.cashierName}</td>
                  <td>{s.customerName ?? "Walk-in"}</td>
                  <td className="num">{s.itemCount}</td>
                  <td className="num">{formatIndianCurrency(s.netPaise)}</td>
                  <td className="r p5b-nowrap">{printButtons(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sales?.length === 0 && (
          <div className="empty-state sal-empty">
            <div className="empty-state-title">No sales yet</div>
            Completed bills from Billing will show up here.
          </div>
        )}
        {sales && sales.length > 0 && visible?.length === 0 && (
          <div className="note sal-nomatch">None of the last {RECENT_LIMIT} bills match. Use Find for an older bill.</div>
        )}
      </BlueprintCard>
    </div>
  );
}
