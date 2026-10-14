import type { ExchangeReturnSummary, InvoiceData, PaymentMode } from "@pos/types";

import { formatIndianCurrency } from "./money.js";
import { escapeHtml, PAYOUT_LABEL, RECEIPT_FONT_STACK, receiptNameLines, type ReceiptLanguage } from "./receiptLayout.js";

/**
 * A GST tax invoice on A4, for customers who need a proper invoice (a business buying
 * stock, a claim) rather than a till roll. Built from the saved bill only, so the figures are
 * exactly what was charged: the per-line CGST/SGST and totals are the ones stored with the
 * sale, not recomputed here.
 *
 * Not included on purpose: amount in words.
 */

export interface A4InvoiceOptions {
  /** "DUPLICATE COPY" under the title — decided by the main process from the print log. */
  duplicate: boolean;
}

const PAYMENT_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Credit (khata)",
};

export interface TaxRateSummaryRow {
  ratePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

/** Taxable value and tax per GST rate — the table a GST invoice carries under the items. */
export function summariseTaxByRate(items: InvoiceData["items"]): TaxRateSummaryRow[] {
  const byRate = new Map<number, TaxRateSummaryRow>();
  for (const item of items) {
    const row = byRate.get(item.taxRatePercent) ?? {
      ratePercent: item.taxRatePercent,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
    };
    row.taxablePaise += item.taxablePaise;
    row.cgstPaise += item.cgstPaise;
    row.sgstPaise += item.sgstPaise;
    byRate.set(item.taxRatePercent, row);
  }
  return [...byRate.values()].sort((a, b) => a.ratePercent - b.ratePercent);
}

function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

function formatRate(percent: number): string {
  return `${Math.round(percent * 100) / 100}%`;
}

function money(paise: number): string {
  return escapeHtml(formatIndianCurrency(paise));
}

export function buildA4InvoiceHtml(data: InvoiceData, language: ReceiptLanguage, options: A4InvoiceOptions): string {
  const { sale, store, customer } = data;

  const itemRows = data.items
    .map((item, index) => {
      const names = receiptNameLines(item.name, item.nameTamil, language)
        .map(
          (n, i) =>
            `<div class="${i === 0 ? "name" : "name-alt"}"${n.lang === "ta" ? ' lang="ta"' : ""}>${escapeHtml(n.text)}</div>`,
        )
        .join("");
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>${names}</td>
          <td>${item.hsnCode ? escapeHtml(item.hsnCode) : "—"}</td>
          <td class="num">${escapeHtml(formatQty(item.qty))} ${escapeHtml(item.uom)}</td>
          <td class="num">${money(item.unitPricePaise)}</td>
          <td class="num">${item.discountPaise > 0 ? money(item.discountPaise) : "—"}</td>
          <td class="num">${money(item.taxablePaise)}</td>
          <td class="num">${escapeHtml(formatRate(item.taxRatePercent))}</td>
          <td class="num">${money(item.cgstPaise)}</td>
          <td class="num">${money(item.sgstPaise)}</td>
          <td class="num">${money(item.lineTotalPaise)}</td>
        </tr>`;
    })
    .join("");

  const taxRows = summariseTaxByRate(data.items)
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(formatRate(r.ratePercent))}</td>
          <td class="num">${money(r.taxablePaise)}</td>
          <td class="num">${escapeHtml(formatRate(r.ratePercent / 2))} · ${money(r.cgstPaise)}</td>
          <td class="num">${escapeHtml(formatRate(r.ratePercent / 2))} · ${money(r.sgstPaise)}</td>
          <td class="num">${money(r.cgstPaise + r.sgstPaise)}</td>
        </tr>`,
    )
    .join("");

  const paymentRows = data.payments
    .map((p) => {
      const row = `<div class="row"><span>${escapeHtml(PAYMENT_LABEL[p.mode] ?? p.mode)}${
        p.refNo ? ` (${escapeHtml(p.refNo)})` : ""
      }</span><span>${money(p.amountPaise)}</span></div>`;
      if (p.mode !== "cash" || p.tenderedPaise == null) return row;
      const changeLabel = p.changeAction === "khata" ? "Change kept on khata" : "Change returned";
      return `${row}
        <div class="row"><span>Cash tendered</span><span>${money(p.tenderedPaise)}</span></div>
        <div class="row"><span>${changeLabel}</span><span>${money(p.tenderedPaise - p.amountPaise)}</span></div>`;
    })
    .join("");

  const total = (label: string, value: string, cls = ""): string =>
    `<div class="row ${cls}"><span>${label}</span><span>${value}</span></div>`;

  const customerBlock = customer
    ? `<div><strong>${escapeHtml(customer.name)}</strong></div>
       ${customer.phone ? `<div>Phone: ${escapeHtml(customer.phone)}</div>` : ""}
       ${customer.address ? `<div>${escapeHtml(customer.address)}</div>` : ""}`
    : `<div>Walk-in customer</div>`;

  const exchangeTable = buildExchangeReturnTable(data.exchangeReturn, language);
  const exchangeTotalsRows = buildExchangeReturnTotalsRows(data.exchangeReturn, sale.netPaise, money);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(sale.billNo)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: ${RECEIPT_FONT_STACK}; font-size: 10.5px; line-height: 1.4; color: #000; }
      h1 { font-size: 18px; margin: 0; }
      .title { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 2px; margin: 8px 0 2px; }
      .duplicate { text-align: center; font-weight: 700; letter-spacing: 1px; border: 1px solid #000; padding: 2px 0; margin: 4px auto; width: 50%; }
      .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #000; padding-bottom: 6px; }
      .parties { display: flex; justify-content: space-between; gap: 16px; margin: 8px 0; }
      .parties > div { flex: 1; }
      .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #444; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
      th { background: #eee; font-size: 9.5px; text-align: left; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .name { font-weight: 600; overflow-wrap: anywhere; }
      .name-alt { overflow-wrap: anywhere; }
      .bottom { display: flex; justify-content: space-between; gap: 16px; margin-top: 8px; break-inside: avoid; }
      .bottom > div { flex: 1; }
      .row { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
      .grand { font-weight: 700; font-size: 13px; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; }
      .foot { margin-top: 16px; text-align: center; font-size: 9.5px; color: #444; }
    </style>
  </head>
  <body>
    <div class="head">
      <div>
        <h1>${escapeHtml(store.name)}</h1>
        ${store.address ? `<div>${escapeHtml(store.address)}</div>` : ""}
        ${store.gstin ? `<div>GSTIN: <strong>${escapeHtml(store.gstin)}</strong></div>` : ""}
        ${store.stateCode ? `<div>State code: ${escapeHtml(store.stateCode)}</div>` : ""}
      </div>
      <div style="text-align: right">
        <div>Invoice no: <strong>${escapeHtml(sale.billNo)}</strong></div>
        <div>Date: ${escapeHtml(new Date(sale.createdAt).toLocaleString("en-IN"))}</div>
        ${data.cashierName ? `<div>Billed by: ${escapeHtml(data.cashierName)}</div>` : ""}
      </div>
    </div>
    <div class="title">TAX INVOICE</div>
    ${options.duplicate ? `<div class="duplicate">DUPLICATE COPY</div>` : ""}
    <div class="parties">
      <div>
        <div class="label">Bill to</div>
        ${customerBlock}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th>
          <th class="num">Discount</th><th class="num">Taxable</th><th class="num">GST</th>
          <th class="num">CGST</th><th class="num">SGST</th><th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}
      </tbody>
    </table>
    ${exchangeTable}
    <div class="bottom">
      <div>
        <table>
          <thead>
            <tr><th>GST rate</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total tax</th></tr>
          </thead>
          <tbody>${taxRows}
          </tbody>
        </table>
        ${paymentRows ? `<div style="margin-top: 8px"><div class="label">Paid by</div>${paymentRows}</div>` : ""}
      </div>
      <div>
        ${total("Gross", money(sale.grossPaise))}
        ${total("Discount", `-${money(sale.discountPaise)}`)}
        ${total("Taxable value", money(sale.taxablePaise))}
        ${total("CGST", money(sale.cgstPaise))}
        ${total("SGST", money(sale.sgstPaise))}
        ${total("Round off", money(sale.roundOffPaise))}
        ${total("Invoice total", money(sale.netPaise), "grand")}
        ${exchangeTotalsRows}
      </div>
    </div>
    <div class="foot">This is a computer-generated invoice.</div>
  </body>
</html>`;
}

/** The returned-items table between the main items table and the totals section, or "" when
 * this bill has no linked return (not an exchange). */
function buildExchangeReturnTable(exchangeReturn: ExchangeReturnSummary | null | undefined, language: ReceiptLanguage): string {
  if (!exchangeReturn) return "";

  const rows = exchangeReturn.lines
    .map((line, index) => {
      const names = receiptNameLines(line.name, line.nameTamil, language)
        .map(
          (n, i) =>
            `<div class="${i === 0 ? "name" : "name-alt"}"${n.lang === "ta" ? ' lang="ta"' : ""}>${escapeHtml(n.text)}</div>`,
        )
        .join("");
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>${names}</td>
          <td class="num">${escapeHtml(formatQty(line.qty))} ${escapeHtml(line.uom)}</td>
          <td class="num">-${money(line.amountPaise)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="label" style="margin-top: 8px">
      Returned against bill ${escapeHtml(exchangeReturn.originalBillNo)} · credit note ${escapeHtml(exchangeReturn.returnNo)}
    </div>
    <table>
      <thead>
        <tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>`;
}

/** The two totals rows that follow "Invoice total" when this bill has a linked return, or ""
 * otherwise. "Invoice total" itself is never touched — it stays the sale's own full net. */
function buildExchangeReturnTotalsRows(
  exchangeReturn: ExchangeReturnSummary | null | undefined,
  netPaise: number,
  money: (paise: number) => string,
): string {
  if (!exchangeReturn) return "";

  const total = (label: string, value: string, cls = ""): string =>
    `<div class="row ${cls}"><span>${label}</span><span>${value}</span></div>`;

  const finalRow =
    exchangeReturn.payoutPaise === 0
      ? total("Amount payable", money(netPaise - exchangeReturn.refundPaise), "grand")
      : total(
          // payoutMode is only null when payoutPaise is 0 (the whole refund was absorbed) —
          // see ExchangeReturnSummary's doc comment — so it's set here.
          `Refunded to customer (${PAYOUT_LABEL[exchangeReturn.payoutMode as PaymentMode]})`,
          money(exchangeReturn.payoutPaise),
          "grand",
        );

  return `${total("Return credit", `-${money(exchangeReturn.refundPaise)}`)}${finalRow}`;
}
