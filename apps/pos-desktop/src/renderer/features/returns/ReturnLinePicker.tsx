import { computeReturnTotals, formatIndianCurrency, isFractionalUom, ReturnQuantityError, roundQtyForUom } from "@pos/business-logic";
import type { RefundMode, ReturnableLine, ReturnableSale } from "@pos/types";

/** The four ways a standalone refund can be paid out. "exchange" is never offered here — it's
 * set only internally, once the return's value is set off against a new bill. */
export const PAYOUT_MODES = ["cash", "upi", "card", "credit"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

export const REFUND_LABEL: Record<RefundMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "To khata",
  exchange: "Set against new bill",
};

export interface ReturnLineSelection {
  line: ReturnableLine;
  qty: number;
}

export interface ReturnPreview {
  selected: ReturnLineSelection[];
  refundPaise: number;
  previewError: string | null;
}

/**
 * The same preview math the Returns screen has always shown, and that an exchange's picker
 * on the Billing screen now shows too: parses the typed quantities, runs them through the
 * real return engine (so the number on screen is the number that would actually be charged),
 * and reports back what's selected, what it refunds, and any quantity error to show instead.
 */
export function previewReturn(sale: ReturnableSale, qtys: Record<string, string>): ReturnPreview {
  const selected = sale.lines
    .map((line) => ({ line, qty: roundQtyForUom(Number(qtys[line.saleItemId]) || 0, line.uom) }))
    .filter((s) => s.qty > 0);

  let refundPaise = 0;
  let previewError: string | null = null;
  if (selected.length > 0) {
    try {
      refundPaise = computeReturnTotals(
        selected.map(({ line, qty }) => ({
          saleItemId: line.saleItemId,
          productId: line.productId,
          soldQty: line.soldQty,
          alreadyReturnedQty: line.alreadyReturnedQty,
          returnQty: qty,
          discountPaise: line.discountPaise,
          taxablePaise: line.taxablePaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          lineTotalPaise: line.lineTotalPaise,
        })),
      ).totals.refundPaise;
    } catch (error) {
      previewError = error instanceof ReturnQuantityError ? error.message : "Check the quantities.";
    }
  }

  return { selected, refundPaise, previewError };
}

interface ReturnLinePickerProps {
  sale: ReturnableSale;
  qtys: Record<string, string>;
  onQtyChange: (saleItemId: string, value: string) => void;
}

/** The bill-lines table with a quantity box per returnable line — shared by the standalone
 * Returns screen and the Billing screen's "Return item…" picker. */
export function ReturnLinePicker({ sale, qtys, onQtyChange }: ReturnLinePickerProps): JSX.Element {
  return (
    <table className="table ret-picker">
      <thead>
        <tr>
          <th>Item</th>
          <th className="num">Sold</th>
          <th className="num">Already back</th>
          <th>Returning</th>
          <th className="num">Line total</th>
        </tr>
      </thead>
      <tbody>
        {sale.lines.map((line) => (
          <tr key={line.saleItemId}>
            <td>{line.productName}</td>
            <td className="num">
              {line.soldQty} {line.uom}
            </td>
            <td className="num text-muted">{line.alreadyReturnedQty > 0 ? line.alreadyReturnedQty : "—"}</td>
            <td>
              {line.returnableQty > 0 ? (
                <input
                  type="number"
                  min={0}
                  max={line.returnableQty}
                  step={isFractionalUom(line.uom) ? 0.01 : 1}
                  placeholder="0"
                  aria-label={`Quantity of ${line.productName} to return`}
                  value={qtys[line.saleItemId] ?? ""}
                  onChange={(e) => onQtyChange(line.saleItemId, e.target.value)}
                  className="ret-qty"
                />
              ) : (
                <span className="pill mute">all returned</span>
              )}
            </td>
            <td className="num">{formatIndianCurrency(line.lineTotalPaise)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
