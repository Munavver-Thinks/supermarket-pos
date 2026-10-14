import type { StockMovementReason } from "./common.js";

export interface InventoryRow {
  productId: string;
  storeId: string;
  qtyOnHand: number;
  reorderLevel: number;
  updatedAt: string;
}

/** Append-only. Never updated or deleted once written. */
export interface StockLedgerEntry {
  id: string;
  storeId: string;
  productId: string;
  qtyChange: number;
  reason: StockMovementReason;
  referenceType: "sale" | "purchase" | "stock_adjustment" | "manual" | "repack";
  referenceId: string;
  userId: string;
  createdAt: string;
}

export interface StockAdjustment {
  id: string;
  storeId: string;
  productId: string;
  qtyBefore: number;
  qtyAfter: number;
  reason: Extract<
    StockMovementReason,
    "manual_stock_in" | "adjustment_damaged" | "adjustment_missing" | "adjustment_correction" | "adjustment_expired"
  >;
  note: string | null;
  userId: string;
  approvedByUserId: string | null;
  createdAt: string;
}
