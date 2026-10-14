import type { PaymentMode, SaleStatus } from "./common.js";

export interface Customer {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  address: string | null;
  /** 0 means no limit has been set, not "no credit allowed". */
  creditLimitPaise: number;
  createdAt: string;
}

export type LedgerEntryType =
  | "credit_sale"
  | "repayment"
  | "return_refund"
  | "opening_balance"
  | "write_off"
  | "change_to_khata";

/** What happens to change due back to the customer, when cash tendered exceeds what was due. */
export type ChangeAction = "handback" | "khata";

/** Credit is not a way to refund a customer who never owed anything — see returns repo.
 * "exchange" means the whole refund was set off against a linked sale rather than paid out —
 * see the exchange return flow in returns.ts / sales.ts. */
export type RefundMode = PaymentMode | "exchange";

export interface SaleReturn {
  id: string;
  storeId: string;
  counterId: string;
  saleId: string;
  returnNo: string;
  clientTxnId: string;
  userId: string;
  reason: string | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  discountPaise: number;
  roundOffPaise: number;
  refundPaise: number;
  refundMode: RefundMode;
  createdAt: string;
  /** The new sale this return's value was set off against, for an exchange. Null otherwise. */
  exchangeSaleId: string | null;
  /** How much of refundPaise was absorbed into the linked sale rather than paid out. */
  exchangePaise: number;
}

/** One line of an original bill, with how much of it can still be sent back. */
export interface ReturnableLine {
  saleItemId: string;
  productId: string;
  productName: string;
  uom: string;
  soldQty: number;
  alreadyReturnedQty: number;
  returnableQty: number;
  unitPricePaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

/** A bill looked up for return, with its lines and what has already come back. */
export interface ReturnableSale {
  saleId: string;
  billNo: string;
  createdAt: string;
  netPaise: number;
  customerId: string | null;
  customerName: string | null;
  /** True when the bill had a credit portion, so refunding to khata makes sense. */
  hadCreditPayment: boolean;
  lines: ReturnableLine[];
}

/** Headline figures for a date range, with returns already netted off. */
export interface SalesReport {
  billCount: number;
  returnCount: number;
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  refundPaise: number;
  netPaise: number;
  paymentMix: PaymentModeTotal[];
}

/** One rate band of a GSTR-1 return. */
export interface GstRateRow {
  taxRatePercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
}

/** One HSN code's row of a GSTR-1 return. A null code means the product has none set. */
export interface HsnSummaryRow {
  hsnCode: string | null;
  taxRatePercent: number;
  qty: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  uom: string;
  qty: number;
  revenuePaise: number;
}

export interface StockValuationRow {
  productId: string;
  name: string;
  uom: string;
  qtyOnHand: number;
  costPricePaise: number;
  salePricePaise: number;
  valuePaise: number;
}

export interface RecentReturn {
  id: string;
  returnNo: string;
  billNo: string;
  createdAt: string;
  refundPaise: number;
  refundMode: RefundMode;
  itemCount: number;
  userName: string;
  /** Who signed off the refund; null for returns recorded before approvals existed. */
  approvedByName: string | null;
  /** The bill number of the sale this return was set off against, for an exchange. */
  exchangeBillNo: string | null;
  exchangePaise: number;
}

export interface CustomerLedgerEntry {
  id: string;
  storeId: string;
  customerId: string;
  entryType: LedgerEntryType;
  /** Signed, from the customer's side: positive increases what they owe. */
  amountPaise: number;
  saleId: string | null;
  /** Bill number of the linked sale, when there is one. */
  billNo: string | null;
  paymentMode: PaymentMode | null;
  note: string | null;
  userId: string;
  createdAt: string;
}

/** A customer with money outstanding, for the khata list. */
export interface CustomerBalance {
  customerId: string;
  name: string;
  phone: string | null;
  balancePaise: number;
  creditLimitPaise: number;
  lastActivityAt: string | null;
}

export interface CartLine {
  /** Client-generated, stable for the life of the line so repeated edits don't create duplicates. */
  lineId: string;
  productId: string;
  name: string;
  uom: string;
  qty: number;
  unitPricePaise: number;
  isTaxInclusive: boolean;
  taxRatePercent: number;
  discountPercent: number;
  discountFlatPaise: number;
}

export interface CartLineTotal extends CartLine {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
}

export interface Cart {
  /** Client-generated UUID. Doubles as the idempotency key for sale creation. */
  clientTxnId: string;
  storeId: string;
  counterId: string;
  userId: string;
  customerId: string | null;
  lines: CartLine[];
  billDiscountPercent: number;
  billDiscountFlatPaise: number;
  heldAt: string | null;
  /** When true, a newly added line uses the product's wholesale rate instead of its sale
   * price (see cartStore.ts's addProduct) — nothing outside the renderer reads this; a sale's
   * price is whatever ended up on the line, same as always. Optional so existing carts
   * (tests, older drafts) read as a normal retail bill. */
  isWholesale?: boolean;
}

export interface CartTotals {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  netPaise: number;
}

export interface PaymentInput {
  mode: PaymentMode;
  amountPaise: number;
  refNo: string | null;
  /** Cash leg only; set only when cash handed over exceeded its due share; `amountPaise` is
   * always the applied amount. `| undefined` (not just omission) so a zod `.nullable().optional()`
   * parse result — whose output type includes explicit `undefined` — assigns under
   * exactOptionalPropertyTypes. */
  tenderedPaise?: number | null | undefined;
  /** Cash leg only; set only when cash handed over exceeded its due share; `amountPaise` is
   * always the applied amount. See `tenderedPaise` above for why `| undefined` is explicit. */
  changeAction?: ChangeAction | null | undefined;
}

export interface Sale {
  id: string;
  storeId: string;
  counterId: string;
  billNo: string;
  clientTxnId: string;
  userId: string;
  customerId: string | null;
  status: SaleStatus;
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  netPaise: number;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  lineNo: number;
  productId: string;
  qty: number;
  unitPricePaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxRatePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export interface Payment {
  id: string;
  saleId: string;
  mode: PaymentMode;
  amountPaise: number;
  refNo: string | null;
  createdAt: string;
}

export interface CreateSaleRequest {
  cart: Cart;
  payments: PaymentInput[];
}

export interface CreateSaleResult {
  sale: Sale;
  alreadyExisted: boolean;
}

export interface PaymentModeTotal {
  mode: PaymentMode;
  amountPaise: number;
}

export interface SalesSummary {
  netPaise: number;
  billCount: number;
  paymentMix: PaymentModeTotal[];
}

export interface RecentSale {
  id: string;
  billNo: string;
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  itemCount: number;
  netPaise: number;
}
