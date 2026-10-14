import { formatIndianCurrency } from "./money.js";
import { labelMonth } from "./shelfLabel.js";

/** Plain-language names for what the log records, as a shopkeeper would say them. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  sale_created: "Bill",
  sale_return: "Return",
  stock_adjustment: "Stock corrected",
  purchase_received: "Purchase received",
  cost_price_changed: "Cost price changed",
  mrp_changed: "MRP changed",
  product_created: "Product added",
  credit_repayment: "Khata payment",
  credit_limit_changed: "Credit limit changed",
  cash_session_opened: "Register opened",
  cash_session_closed: "Register closed",
  employee_created: "Employee added",
  setting_changed: "Setting changed",
  supplier_created: "Supplier added",
  supplier_updated: "Supplier edited",
  customer_created: "Customer added",
  customer_updated: "Customer edited",
  stock_repacked: "Stock repacked",
  supplier_deactivated: "Supplier deactivated",
  supplier_reactivated: "Supplier reactivated",
  backup_restored: "Backup restored",
  // DEV1: approvals, reprints, staff
  approval_refused: "Approval refused",
  below_cost_discount_approved: "Below-cost discount approved",
  receipt_reprinted: "Bill reprinted",
  employee_updated: "Employee edited",
  employee_deactivated: "Employee deactivated",
  employee_reactivated: "Employee reactivated",
  password_reset: "Password reset",
  password_changed: "Password changed",
  // DEV2: batches, purchase orders, products
  batch_written_off: "Expired stock written off",
  purchase_order_created: "Purchase order created",
  purchase_order_updated: "Purchase order edited",
  purchase_order_placed: "Purchase order placed",
  purchase_order_cancelled: "Purchase order cancelled",
  goods_received: "Goods received",
  product_updated: "Product edited",
  product_price_changed: "Price changed",
  product_deactivated: "Product deactivated",
  product_reactivated: "Product reactivated",
  labels_printed: "Labels printed",
  barcode_assigned: "Barcode assigned",
};

/** Shop-language names for product fields, in the order the edit form shows them. */
const PRODUCT_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["name", "name"],
  ["nameTamil", "Tamil name"],
  ["shortCode", "short code"],
  ["uom", "unit"],
  ["isWeighted", "sold by weight"],
  ["hsnCode", "HSN"],
  ["taxRatePercent", "GST %"],
  ["reorderLevel", "reorder level"],
  ["supplierId", "supplier"],
  ["barcodes", "barcodes"],
  ["aliases", "other names"],
];

const PRICE_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["salePricePaise", "Sale"],
  ["mrpPaise", "MRP"],
  ["costPricePaise", "Cost"],
];

/** What a manager was asked to approve, as the log reads it. */
const APPROVAL_ACTION_LABELS: Record<string, string> = {
  sale_return: "a return",
  below_cost_discount: "a below-cost discount",
  stock_adjustment: "a stock correction",
};

const RECEIPT_FORMAT_LABELS: Record<string, string> = {
  receipt: "receipt",
  a4: "A4 invoice",
  pdf: "PDF invoice",
};

/** Shop-language names for supplier fields, in the order the Suppliers form shows them. */
const SUPPLIER_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["name", "name"],
  ["phone", "phone"],
  ["email", "email"],
  ["gstin", "GSTIN"],
  ["address", "address"],
  ["notes", "notes"],
];

/** Shop-language names for customer fields, in the order the customer form shows them. */
const CUSTOMER_FIELD_LABELS: Array<[key: string, label: string]> = [
  ["name", "name"],
  ["phone", "phone"],
  ["address", "address"],
];

export interface DescribableAuditEntry {
  action: string;
  oldValue: unknown;
  newValue: unknown;
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

/**
 * One line summarising what an entry changed. Values come from stored JSON written by older
 * versions of the app too, so every field is read defensively — a missing or oddly shaped
 * value degrades to a shorter sentence rather than "undefined" or a crash.
 */
export function describeAuditEntry(entry: DescribableAuditEntry): string {
  const n = entry.newValue;
  const o = entry.oldValue;

  switch (entry.action) {
    case "sale_created": {
      const parts = [str(n, "billNo"), money(n, "netPaise")];
      const discount = num(n, "discountPaise");
      if (discount) parts.push(`${formatIndianCurrency(discount)} discount`);
      const modes = paymentModes(n);
      if (modes) parts.push(modes);
      // Set when this bill also took back goods from an earlier one (an exchange) — see
      // sales.ts's createSale.
      const exchangeRefundPaise = num(n, "exchangeRefundPaise");
      if (exchangeRefundPaise) parts.push(`return ${formatIndianCurrency(exchangeRefundPaise)} set off`);
      return join(parts);
    }
    case "sale_return": {
      const refundMode = str(n, "refundMode");
      const exchangeBillNo = str(n, "exchangeBillNo");
      const exchangePaise = num(n, "exchangePaise");
      return join([
        str(n, "returnNo"),
        str(n, "billNo") && `against ${str(n, "billNo")}`,
        money(n, "refundPaise") && `refunded ${money(n, "refundPaise")}`,
        // "exchange" means the whole refund was absorbed into a new bill rather than paid
        // out — say which bill instead of the meaningless "in exchange".
        refundMode === "exchange" ? null : refundMode && (refundMode === "credit" ? "to khata" : `in ${refundMode}`),
        refundMode === "exchange" && exchangeBillNo && `set against bill ${exchangeBillNo}`,
        // A partial exchange: some of the refund was absorbed (exchangePaise) while the rest
        // was paid out in refundMode — call out the absorbed part and which bill it went to.
        refundMode !== "exchange" &&
          exchangePaise !== null &&
          exchangePaise > 0 &&
          exchangeBillNo &&
          `${formatIndianCurrency(exchangePaise)} on bill ${exchangeBillNo}`,
      ]);
    }
    case "stock_adjustment":
      return fromTo(num(o, "qtyOnHand"), num(n, "qtyOnHand"), (v) => String(v));
    case "cost_price_changed":
      return describeCostPriceChange(o, n);
    case "mrp_changed":
      return describeMrpChange(o, n);
    case "credit_limit_changed":
      return fromTo(num(o, "creditLimitPaise"), num(n, "creditLimitPaise"), formatIndianCurrency);
    case "purchase_received":
      return join([str(n, "invoiceNo") && `Invoice ${str(n, "invoiceNo")}`, money(n, "totalPaise")]);
    case "product_created":
      return join([str(n, "name"), money(n, "salePricePaise") && `sells at ${money(n, "salePricePaise")}`]);
    case "credit_repayment":
      return join([money(n, "amountPaise"), str(n, "paymentMode") && `by ${str(n, "paymentMode")}`]);
    case "cash_session_opened":
      return join([money(n, "openingCashPaise") && `Float ${money(n, "openingCashPaise")}`]);
    case "cash_session_closed": {
      const variance = num(n, "variancePaise");
      const counted = money(n, "countedCashPaise") && `Counted ${money(n, "countedCashPaise")}`;
      if (variance === null) return join([counted]);
      if (variance === 0) return join([counted, "matched"]);
      return join([counted, `${variance > 0 ? "over" : "short"} by ${formatIndianCurrency(Math.abs(variance))}`]);
    }
    case "employee_created":
      return join([str(n, "displayName"), str(n, "role") && `as ${str(n, "role")?.replace(/_/g, " ")}`]);
    case "setting_changed":
      return fromTo(typeof o === "string" ? o : null, typeof n === "string" ? n : null, (v) => v);
    case "supplier_created":
      return join([str(n, "name"), str(n, "phone"), str(n, "gstin") && `GSTIN ${str(n, "gstin")}`]);
    case "supplier_updated":
      return describeSupplierEdit(o, n);
    case "supplier_deactivated":
    case "supplier_reactivated":
      return join([str(n, "name") ?? str(o, "name")]);
    case "customer_created":
      return join([str(n, "name"), str(n, "phone")]);
    case "customer_updated":
      return describeCustomerEdit(o, n);
    case "stock_repacked":
      return join([
        str(n, "parentName") && `from ${str(n, "parentName")}`,
        num(n, "childQtyMade") !== null && str(n, "childName") && `made ${num(n, "childQtyMade")} ${str(n, "childName")}`,
        str(n, "batchNo") && `batch ${str(n, "batchNo")}`,
        str(n, "packedOn") && `packed ${str(n, "packedOn")}`,
        str(n, "expiryDate") && `best before ${str(n, "expiryDate")}`,
      ]);
    case "labels_printed": {
      const count = num(n, "count");
      const packedOn = str(n, "packedOn");
      return join([
        count !== null && `${count} ${count === 1 ? "label" : "labels"}`,
        str(n, "productName"),
        packedOn && `PKD ${labelMonth(packedOn)}`,
        str(n, "batchNo") && `batch ${str(n, "batchNo")}`,
      ]);
    }
    case "barcode_assigned": {
      const barcode = str(n, "barcode");
      const name = str(n, "productName");
      return barcode ? `Barcode ${barcode} assigned${name ? ` to ${name}` : ""}` : "";
    }
    case "backup_restored": {
      // The actor's account may not exist in the restored data (it was created after the
      // backup), in which case the log's user column is blank — so the name travels here.
      const actorMissing = has(n, "actorInRestoredDb") && field(n, "actorInRestoredDb") === false;
      return join([
        str(n, "backupName") && `From ${str(n, "backupName")}`,
        str(n, "safetyCopyName") && `previous data kept as ${str(n, "safetyCopyName")}`,
        actorMissing && str(n, "actorName") && `by ${str(n, "actorName")}`,
      ]);
    }
    case "approval_refused": {
      const what = str(n, "action");
      return join([
        what && `For ${APPROVAL_ACTION_LABELS[what] ?? what.replace(/_/g, " ")}`,
        str(n, "approverUsername") && `approver "${str(n, "approverUsername")}"`,
        field(n, "lockedOut") === true ? "too many attempts" : "details not accepted",
      ]);
    }
    case "below_cost_discount_approved":
      return join([str(n, "billNo"), money(n, "discountPaise") && `${money(n, "discountPaise")} discount`]);
    case "receipt_reprinted": {
      const format = str(n, "format");
      return join([str(n, "billNo"), format && `as ${RECEIPT_FORMAT_LABELS[format] ?? format}`]);
    }
    case "employee_updated":
      return describeEmployeeEdit(o, n);
    case "employee_deactivated":
    case "employee_reactivated":
      return join([str(n, "displayName") ?? str(o, "displayName")]);
    case "password_reset":
      return join([str(n, "displayName") && `for ${str(n, "displayName")}`]);
    case "password_changed":
      return "";
    case "batch_written_off":
      return join([
        str(n, "batchNo") && `Batch ${str(n, "batchNo")}`,
        str(n, "expiryDate") && `expired ${str(n, "expiryDate")}`,
        num(n, "qty") !== null && `${num(n, "qty")} taken off`,
        fromTo(num(n, "qtyOnHandBefore"), num(n, "qtyOnHandAfter"), (v) => String(v)),
      ]);
    case "purchase_order_created":
    case "purchase_order_updated":
      return join([
        str(n, "poNo"),
        num(n, "lineCount") !== null && `${num(n, "lineCount")} items`,
        money(n, "totalPaise"),
      ]);
    case "purchase_order_placed":
      return join([str(n, "poNo"), money(n, "totalPaise")]);
    case "purchase_order_cancelled":
      return join([str(n, "poNo"), str(n, "status") === "closed" ? "closed after part delivery" : "cancelled"]);
    case "goods_received":
      return join([
        str(n, "poNo"),
        str(n, "invoiceNo") && `Invoice ${str(n, "invoiceNo")}`,
        money(n, "totalPaise"),
        str(n, "status") === "received" ? "fully received" : str(n, "status") && "part received",
      ]);
    case "product_updated":
      return describeProductEdit(o, n);
    case "product_price_changed":
      return describePriceChange(o, n);
    case "product_deactivated":
    case "product_reactivated":
      return join([str(n, "name") ?? str(o, "name")]);
    default:
      return "";
  }
}

/** "Madurai Traders · phone 98400 → 99400 · GSTIN added". Only fields present in the stored diff are mentioned. */
function describeSupplierEdit(before: unknown, after: unknown): string {
  const oldName = str(before, "name");
  const newName = str(after, "name");
  const parts: Array<string | null> = [newName ?? oldName];
  for (const [key, label] of SUPPLIER_FIELD_LABELS) {
    if (!has(after, key)) continue;
    const from = field(before, key);
    const to = field(after, key);
    if (from === to) continue;
    const fromText = typeof from === "string" && from.length > 0 ? from : null;
    const toText = typeof to === "string" && to.length > 0 ? to : null;
    if (fromText && toText) parts.push(`${label} ${fromText} → ${toText}`);
    else if (toText) parts.push(`${label} added`);
    else if (fromText) parts.push(`${label} removed`);
  }
  return join(parts);
}

/** "Lakshmi · phone added · address 12 Car St → 4 Temple St". Only fields present in the stored diff are mentioned. */
function describeCustomerEdit(before: unknown, after: unknown): string {
  const oldName = str(before, "name");
  const newName = str(after, "name");
  const parts: Array<string | null> = [newName ?? oldName];
  for (const [key, label] of CUSTOMER_FIELD_LABELS) {
    if (!has(after, key)) continue;
    const from = field(before, key);
    const to = field(after, key);
    if (from === to) continue;
    const fromText = typeof from === "string" && from.length > 0 ? from : null;
    const toText = typeof to === "string" && to.length > 0 ? to : null;
    if (fromText && toText) parts.push(`${label} ${fromText} → ${toText}`);
    else if (toText) parts.push(`${label} added`);
    else if (fromText) parts.push(`${label} removed`);
  }
  return join(parts);
}

/** "Priya · name Priya S → Priya · role cashier → manager". Only fields present in the stored diff are mentioned. */
function describeEmployeeEdit(before: unknown, after: unknown): string {
  const parts: Array<string | null> = [str(after, "displayName") ?? str(before, "displayName")];
  const role = (v: string) => v.replace(/_/g, " ");
  const oldName = str(before, "displayName");
  const newName = str(after, "displayName");
  if (oldName && newName && oldName !== newName) parts.push(`name ${oldName} → ${newName}`);
  const oldRole = str(before, "role");
  const newRole = str(after, "role");
  if (oldRole && newRole && oldRole !== newRole) parts.push(`role ${role(oldRole)} → ${role(newRole)}`);
  return join(parts);
}

/**
 * "Toor Dal · name Toor Dal 1kg → Toor Dal · barcodes changed". Only fields present in the
 * stored diff are mentioned; lists and ids say "changed" rather than dumping their contents.
 */
function describeProductEdit(before: unknown, after: unknown): string {
  const parts: Array<string | null> = [str(after, "name") ?? str(before, "name")];
  for (const [key, label] of PRODUCT_FIELD_LABELS) {
    if (!has(after, key)) continue;
    const from = field(before, key);
    const to = field(after, key);
    if (from === to) continue;
    const show = (v: unknown): string | null =>
      typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "yes" : "no") : null;
    const fromText = show(from);
    const toText = show(to);
    if (Array.isArray(to) || key === "supplierId") parts.push(`${label} changed`);
    else if (fromText !== null && toText !== null) parts.push(`${label} ${fromText} → ${toText}`);
    else if (toText !== null) parts.push(`${label} added`);
    else if (fromText !== null) parts.push(`${label} removed`);
  }
  return join(parts);
}

/**
 * "₹40.00 → ₹45.00 · new stock at ₹50.00 averaged with 10 on hand" for a receipt that blended
 * cost. Older audit rows (and a cost change recorded some other way) lack receivedCostPaise /
 * qtyOnHandBefore and just get the plain "before → after" text.
 */
function describeCostPriceChange(before: unknown, after: unknown): string {
  const base = fromTo(num(before, "costPricePaise"), num(after, "costPricePaise"), formatIndianCurrency);
  const receivedCostPaise = num(after, "receivedCostPaise");
  const qtyOnHandBefore = num(after, "qtyOnHandBefore");
  if (receivedCostPaise === null || qtyOnHandBefore === null) return base;
  return join([base, `new stock at ${formatIndianCurrency(receivedCostPaise)} averaged with ${qtyOnHandBefore} on hand`]);
}

/**
 * "₹35.00 → ₹40.00 · from new stock · selling price lowered to ₹38.00" for a receipt that
 * flat-replaced the MRP. A lowered-price note is appended only when the sale/wholesale price
 * actually dropped as a consequence — a receipt never raises them back up.
 */
function describeMrpChange(before: unknown, after: unknown): string {
  const base = fromTo(num(before, "mrpPaise"), num(after, "mrpPaise"), formatIndianCurrency);
  const parts: Array<string | null> = [base, "from new stock"];

  const oldSale = num(before, "salePricePaise");
  const newSale = num(after, "salePricePaise");
  if (oldSale !== null && newSale !== null && newSale < oldSale) {
    parts.push(`selling price lowered to ${formatIndianCurrency(newSale)}`);
  }

  const oldWholesale = num(before, "wholesalePricePaise");
  const newWholesale = num(after, "wholesalePricePaise");
  if (oldWholesale !== null && newWholesale !== null && newWholesale < oldWholesale) {
    parts.push(`wholesale price lowered to ${formatIndianCurrency(newWholesale)}`);
  }

  return join(parts);
}

/** "Toor Dal · Sale ₹48.00 → ₹50.00 · now tax-exclusive". Unchanged prices are left out. */
function describePriceChange(before: unknown, after: unknown): string {
  const parts: Array<string | null> = [str(after, "name")];
  for (const [key, label] of PRICE_FIELD_LABELS) {
    const from = num(before, key);
    const to = num(after, key);
    if (from === null || to === null || from === to) continue;
    parts.push(`${label} ${formatIndianCurrency(from)} → ${formatIndianCurrency(to)}`);
  }
  const wasInclusive = field(before, "isTaxInclusive");
  const isInclusive = field(after, "isTaxInclusive");
  if (typeof wasInclusive === "boolean" && typeof isInclusive === "boolean" && wasInclusive !== isInclusive) {
    parts.push(isInclusive ? "now tax-inclusive" : "now tax-exclusive");
  }
  return join(parts);
}

function has(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && key in value;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function num(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function str(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function money(value: unknown, key: string): string | null {
  const paise = num(value, key);
  return paise === null ? null : formatIndianCurrency(paise);
}

function paymentModes(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const payments = (value as Record<string, unknown>).payments;
  if (!Array.isArray(payments)) return null;
  const modes = payments
    .map((p) => (typeof p === "object" && p !== null ? (p as Record<string, unknown>).mode : null))
    .filter((m): m is string => typeof m === "string");
  return modes.length > 0 ? modes.join(" + ") : null;
}

function fromTo<T>(before: T | null, after: T | null, format: (v: T) => string): string {
  if (before !== null && after !== null) return `${format(before)} → ${format(after)}`;
  if (after !== null) return `→ ${format(after)}`;
  return "";
}

function join(parts: Array<string | null | false | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}
