/**
 * Counter-side types shared by the main process and the renderer: manager approval,
 * invoices, device activation and the screen language.
 */

import type { PaymentMode } from "./common.js";
import type { ChangeAction, Sale } from "./sale.js";

/**
 * A manager's or owner's username and password, typed at the counter to approve one request.
 * Sent with that request only; the main process checks it and never stores, logs or returns it.
 */
export interface ApproverCredentials {
  username: string;
  password: string;
}

/**
 * - activated: a stored key verifies for this device.
 * - unactivated: a new install that has not been activated — the app is gated.
 * - not_activated_legacy: an install from before activation existed — nothing is gated.
 * - developer: a development run; activation is not enforced.
 */
export type ActivationStatus = "activated" | "unactivated" | "not_activated_legacy" | "developer";

export interface ActivationInfo {
  status: ActivationStatus;
  /** What the shop reads out to the vendor to get a key, e.g. "1A2B-3C4D-5E6F-7A8B". */
  requestCode: string;
  /** From the verified key only; null otherwise. */
  licenseId: string | null;
  storeName: string | null;
  issuedAt: string | null;
  /** Why a stored key was not accepted, when there is one. */
  reason: string | null;
}

/** The language the screens are shown in (receipts have their own setting). */
export type UiLanguage = "en" | "ta";

/** How a bill was put on paper: 80 mm thermal receipt, printed A4 invoice, or saved A4 PDF. */
export type ReceiptPrintFormat = "receipt" | "a4" | "pdf";

export interface InvoiceItem {
  lineNo: number;
  productId: string;
  name: string;
  nameTamil: string | null;
  hsnCode: string | null;
  uom: string;
  qty: number;
  unitPricePaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxRatePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export interface InvoicePayment {
  mode: PaymentMode;
  amountPaise: number;
  refNo: string | null;
  /** Cash leg only; set only when cash handed over exceeded its due share. Optional so existing
   * InvoicePayment literals (test fixtures) keep compiling. */
  tenderedPaise?: number | null;
  /** Cash leg only; set only when cash handed over exceeded its due share. Optional so existing
   * InvoicePayment literals (test fixtures) keep compiling. */
  changeAction?: ChangeAction | null;
}

/** The "RETURNED ITEMS" section of a bill that took back goods from an earlier one in the
 * same visit (an exchange). Built once from the linked sale_returns row and printed on both
 * the receipt and the A4 invoice — see receiptLayout.ts / invoiceA4Layout.ts. */
export interface ExchangeReturnSummary {
  returnNo: string;
  originalBillNo: string;
  originalBillDate: string;
  refundPaise: number;
  roundOffPaise: number;
  exchangePaise: number;
  /** What was actually handed back to the customer: refundPaise − exchangePaise. */
  payoutPaise: number;
  /** Null when the whole refund was absorbed into this bill (payoutPaise is 0). */
  payoutMode: PaymentMode | null;
  lines: Array<{ name: string; nameTamil: string | null; qty: number; uom: string; amountPaise: number }>;
}

/** Everything a printed receipt or GST invoice shows, read from the saved bill. */
export interface InvoiceData {
  sale: Sale;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  customer: { name: string; phone: string | null; address: string | null } | null;
  cashierName: string | null;
  store: { name: string; address: string | null; gstin: string | null; stateCode: string | null };
  /** Set when this bill took back goods from an earlier one (an exchange). Absent/null for a
   * plain sale. Optional so existing InvoiceData literals (test fixtures) keep compiling. */
  exchangeReturn?: ExchangeReturnSummary | null;
}
