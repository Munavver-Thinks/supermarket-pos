export type UserRole = "owner" | "manager" | "cashier" | "inventory_staff";

export type PaymentMode = "cash" | "upi" | "card" | "credit";

export type SaleStatus = "completed" | "voided";

export type StockMovementReason =
  | "sale"
  | "sale_return"
  | "purchase_received"
  | "manual_stock_in"
  | "adjustment_damaged"
  | "adjustment_missing"
  | "adjustment_correction"
  | "adjustment_expired"
  /** Taken off a bulk parent product when it's broken into pack-size children. */
  | "repack_out"
  /** Received into a pack-size child product from its parent. */
  | "repack_in";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Store {
  id: string;
  organizationId: string;
  name: string;
  address: string | null;
  gstin: string | null;
  stateCode: string | null;
  createdAt: string;
}

export interface Device {
  id: string;
  storeId: string;
  name: string;
  activationKey: string;
  activatedAt: string | null;
}

export interface User {
  id: string;
  storeId: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
}

/**
 * One audit-log entry as shown to a person: stored JSON already parsed and the acting user's
 * name resolved. The raw table row, with values still as JSON text, is AuditLogEntry.
 */
export interface AuditActivityEntry {
  id: string;
  action: string;
  tableName: string;
  recordId: string;
  /** Parsed from stored JSON; null when nothing was recorded. */
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  userId: string;
  userName: string | null;
  deviceId: string | null;
  createdAt: string;
}
