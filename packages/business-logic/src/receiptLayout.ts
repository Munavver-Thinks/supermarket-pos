import type { ChangeAction, ExchangeReturnSummary, PaymentMode, Sale, SaleItem } from "@pos/types";

import { formatIndianCurrency } from "./money.js";

/** How each payout mode reads on a printed receipt. "Khata" rather than "Credit" — the
 * receipt is handed to the customer, who thinks of it by their own account, not the ledger
 * entry type. */
export const PAYOUT_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "Khata",
};

/**
 * Which product names a printed receipt carries.
 *
 * - english:     English name only.
 * - bilingual:   English name, with the Tamil name beneath it.
 * - tamil_first: Tamil name, with the English name beneath it.
 *
 * The default is bilingual: most customers at a Tamil Nadu counter read Tamil, but GST
 * inspectors, distributors and the accounts side read English, so both belong on the bill.
 * Products without a Tamil name always print English only, whatever the setting.
 */
export type ReceiptLanguage = "english" | "bilingual" | "tamil_first";

export const RECEIPT_LANGUAGES: ReceiptLanguage[] = ["english", "bilingual", "tamil_first"];

export const DEFAULT_RECEIPT_LANGUAGE: ReceiptLanguage = "bilingual";

/** The app_settings key the receipt language is stored under. */
export const RECEIPT_LANGUAGE_KEY = "receipt.language";

/** Reads a stored value, falling back to the default for anything missing or unrecognised. */
export function parseReceiptLanguage(raw: string | undefined | null): ReceiptLanguage {
  return RECEIPT_LANGUAGES.includes(raw as ReceiptLanguage) ? (raw as ReceiptLanguage) : DEFAULT_RECEIPT_LANGUAGE;
}

export interface ReceiptItemInput {
  item: SaleItem;
  productName: string;
  productNameTamil: string | null;
}

export interface ReceiptData {
  storeName: string;
  storeAddress: string | null;
  storeGstin: string | null;
  sale: Sale;
  items: ReceiptItemInput[];
  /** Set when this bill took back goods from an earlier one in the same visit (an exchange). */
  exchangeReturn?: ExchangeReturnSummary | null;
  /** Set when the cash leg was overpaid — the thermal receipt prints no other payment lines,
   * so this is the only payment detail it ever shows. Absent/null for a normal bill. */
  cashTender?: { tenderedPaise: number; changePaise: number; changeAction: ChangeAction } | null;
}

export interface ReceiptNameLine {
  text: string;
  /** Marks Tamil lines so the renderer can tag them `lang="ta"` for correct shaping. */
  lang: "en" | "ta";
}

export interface ReceiptLine {
  /** One or two name lines, primary first. Never empty strings. */
  names: ReceiptNameLine[];
  qty: string;
  rate: string;
  amount: string;
}

/**
 * The name lines for one product under a language setting. A blank or whitespace-only
 * Tamil name counts as missing — an imported catalog can hold "" rather than null, and
 * either would otherwise print as an empty line under the item.
 */
export function receiptNameLines(
  name: string,
  nameTamil: string | null | undefined,
  language: ReceiptLanguage,
): ReceiptNameLine[] {
  const english: ReceiptNameLine = { text: name, lang: "en" };
  const tamilText = nameTamil?.trim();
  if (!tamilText || language === "english") return [english];
  const tamil: ReceiptNameLine = { text: tamilText, lang: "ta" };
  return language === "tamil_first" ? [tamil, english] : [english, tamil];
}

export function buildReceiptLines(items: ReceiptItemInput[], language: ReceiptLanguage): ReceiptLine[] {
  return items.map(({ item, productName, productNameTamil }) => ({
    names: receiptNameLines(productName, productNameTamil, language),
    qty: formatReceiptQty(item.qty),
    rate: formatIndianCurrency(item.unitPricePaise),
    amount: formatIndianCurrency(item.lineTotalPaise),
  }));
}

/** Weighed quantities are floats; trim drift like 0.30000000000000004 to at most 3 places. */
function formatReceiptQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

/**
 * Tamil-capable faces first. The receipt is printed from a rendered HTML page through the
 * Windows print driver, so the driver receives already-shaped glyphs — no ESC/POS code page
 * or hand-built bitmap is needed, only a font that has Tamil. Nirmala UI ships with Windows
 * 8+ and Latha with older Windows; both also carry Latin, so English and ₹ stay in one face.
 */
export const RECEIPT_FONT_STACK = `"Nirmala UI", "Latha", "Noto Sans Tamil", "Tamil Sangam MN", "Arial Unicode MS", sans-serif`;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * The full receipt page. Each item is a block — name line(s) across the full width, then
 * "qty × rate" and the amount on the line below — rather than a four-column table: a long
 * Tamil name in a narrow table column either forces the price columns off a 58mm roll or
 * gets clipped. The body is fluid up to 72mm (the printable width of an 80mm roll), so the
 * same page fits 58mm paper too.
 */
export interface ReceiptHtmlOptions {
  /**
   * Stamps "DUPLICATE COPY" under the header. Decided by the main process from the print log
   * — any copy after the first is a duplicate — never by the screen asking for the print.
   */
  duplicate?: boolean;
}

export function buildReceiptHtml(data: ReceiptData, language: ReceiptLanguage, options: ReceiptHtmlOptions = {}): string {
  const { sale, storeName, storeAddress, storeGstin } = data;
  const lines = buildReceiptLines(data.items, language);

  const rows = lines
    .map(
      (line) => `
      <div class="item">
        ${line.names
          .map(
            (n, i) =>
              `<div class="name${i === 0 ? " primary" : ""}"${n.lang === "ta" ? ' lang="ta"' : ""}>${escapeHtml(n.text)}</div>`,
          )
          .join("")}
        <div class="row"><span>${escapeHtml(line.qty)} × ${escapeHtml(line.rate)}</span><span class="amt">${escapeHtml(line.amount)}</span></div>
      </div>`,
    )
    .join("");

  const total = (label: string, value: string, bold = false): string =>
    `<div class="row${bold ? " bold" : ""}"><span>${label}</span><span class="amt">${escapeHtml(value)}</span></div>`;

  const exchangeSection = buildExchangeReturnSection(data.exchangeReturn, sale.netPaise, language);
  const cashTenderSection = buildCashTenderSection(data.cashTender);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: ${RECEIPT_FONT_STACK}; font-size: 12px; line-height: 1.35; color: #000; width: 100%; max-width: 72mm; padding: 0 2mm; }
      h1 { font-size: 14px; text-align: center; margin: 4px 0; overflow-wrap: anywhere; }
      .center { text-align: center; overflow-wrap: anywhere; }
      hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
      .item { padding: 2px 0; break-inside: avoid; }
      .name { overflow-wrap: anywhere; word-break: break-word; }
      .name.primary { font-weight: 600; }
      .row { display: flex; justify-content: space-between; gap: 6px; font-variant-numeric: tabular-nums; }
      .row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
      .amt { white-space: nowrap; }
      .bold { font-weight: 700; }
      .duplicate { text-align: center; font-weight: 700; letter-spacing: 1px; border: 1px solid #000; margin: 4px 0; padding: 1px 0; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(storeName)}</h1>
    ${storeAddress ? `<div class="center">${escapeHtml(storeAddress)}</div>` : ""}
    ${storeGstin ? `<div class="center">GSTIN: ${escapeHtml(storeGstin)}</div>` : ""}
    ${options.duplicate ? `<div class="duplicate">DUPLICATE COPY</div>` : ""}
    <hr />
    <div>Bill No: ${escapeHtml(sale.billNo)}</div>
    <div>Date: ${escapeHtml(new Date(sale.createdAt).toLocaleString("en-IN"))}</div>
    <hr />
    ${rows}
    <hr />
    ${total("Taxable", formatIndianCurrency(sale.taxablePaise))}
    ${total("CGST", formatIndianCurrency(sale.cgstPaise))}
    ${total("SGST", formatIndianCurrency(sale.sgstPaise))}
    ${total("Discount", `-${formatIndianCurrency(sale.discountPaise)}`)}
    ${total("Round off", formatIndianCurrency(sale.roundOffPaise))}
    ${total("Net Total", formatIndianCurrency(sale.netPaise), true)}
    ${exchangeSection}
    ${cashTenderSection}
    <hr />
    <div class="center">Thank you, visit again!</div>
  </body>
</html>`;
}

/**
 * The "RETURNED ITEMS" section for a bill that took back goods from an earlier one in the
 * same visit (an exchange). Empty string when there is no linked return — the caller always
 * splices this in right after Net Total, so an absent return leaves that row untouched.
 */
function buildExchangeReturnSection(
  exchangeReturn: ExchangeReturnSummary | null | undefined,
  netPaise: number,
  language: ReceiptLanguage,
): string {
  if (!exchangeReturn) return "";

  const total = (label: string, value: string, bold = false): string =>
    `<div class="row${bold ? " bold" : ""}"><span>${label}</span><span class="amt">${escapeHtml(value)}</span></div>`;

  const itemRows = exchangeReturn.lines
    .map((line) => {
      const names = receiptNameLines(line.name, line.nameTamil, language)
        .map(
          (n, i) =>
            `<div class="name${i === 0 ? " primary" : ""}"${n.lang === "ta" ? ' lang="ta"' : ""}>${escapeHtml(n.text)}</div>`,
        )
        .join("");
      return `
      <div class="item">
        ${names}
        <div class="row"><span>${escapeHtml(formatReceiptQty(line.qty))} ${escapeHtml(line.uom)}</span><span class="amt">-${escapeHtml(formatIndianCurrency(line.amountPaise))}</span></div>
      </div>`;
    })
    .join("");

  const finalRow =
    exchangeReturn.payoutPaise === 0
      ? total("Amount payable", formatIndianCurrency(netPaise - exchangeReturn.refundPaise), true)
      : total(
          // payoutMode is only ever null when payoutPaise is 0 (the whole refund was absorbed
          // into the sale) — see ExchangeReturnSummary's doc comment — so it's set here.
          `Refunded to customer (${PAYOUT_LABEL[exchangeReturn.payoutMode as PaymentMode]})`,
          formatIndianCurrency(exchangeReturn.payoutPaise),
          true,
        );

  return `
    <hr />
    <div class="bold">RETURNED ITEMS</div>
    <div>Against bill: ${escapeHtml(exchangeReturn.originalBillNo)} (${escapeHtml(new Date(exchangeReturn.originalBillDate).toLocaleDateString("en-IN"))})</div>
    <div>Credit note: ${escapeHtml(exchangeReturn.returnNo)}</div>
    ${itemRows}
    <hr />
    ${total("Return credit", `-${formatIndianCurrency(exchangeReturn.refundPaise)}`)}
    ${exchangeReturn.roundOffPaise !== 0 ? total("Return round off", formatIndianCurrency(exchangeReturn.roundOffPaise)) : ""}
    ${finalRow}`;
}

/**
 * The "Cash tendered / Change" lines for a bill where cash was overpaid. Empty string when
 * `cashTender` is absent — the caller always splices this in right after the exchange-return
 * section (if any) and before the final thank-you line, so a normal bill's receipt is
 * untouched.
 */
function buildCashTenderSection(cashTender: ReceiptData["cashTender"] | undefined): string {
  if (!cashTender) return "";

  const total = (label: string, value: string): string =>
    `<div class="row"><span>${label}</span><span class="amt">${escapeHtml(value)}</span></div>`;

  return `
    <hr />
    ${total("Cash tendered", formatIndianCurrency(cashTender.tenderedPaise))}
    ${total(cashTender.changeAction === "khata" ? "Change kept on khata" : "Change returned", formatIndianCurrency(cashTender.changePaise))}`;
}
