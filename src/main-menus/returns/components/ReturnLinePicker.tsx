import { formatIndianCurrency, isFractionalUom } from "@pos/business-logic";
import type { ReturnableSale } from "@pos/types";

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
