import type { Cart } from "./sale.js";

/** Persisted after every cart mutation so an unfinished bill survives a crash or restart. */
export interface DraftBill {
  clientTxnId: string;
  storeId: string;
  counterId: string;
  userId: string;
  deviceId: string;
  cart: Cart;
  label: string | null;
  updatedAt: string;
}

export interface CashSession {
  id: string;
  storeId: string;
  counterId: string;
  userId: string;
  openingCashPaise: number;
  closingCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface AuditLogEntry {
  id: string;
  storeId: string;
  userId: string;
  deviceId: string | null;
  action: string;
  tableName: string;
  recordId: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ErrorLogEntry {
  id: string;
  errorId: string;
  storeId: string | null;
  userId: string | null;
  message: string;
  stack: string | null;
  context: string | null;
  createdAt: string;
}
