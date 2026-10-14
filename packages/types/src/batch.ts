/** "expired" once the expiry date has passed; "expiring" inside the alert window. */
export type ExpiryStatus = "expired" | "expiring" | "ok";

/** One arrival of a product with its own batch number and/or expiry date. */
export interface StockBatch {
  id: string;
  storeId: string;
  productId: string;
  batchNo: string | null;
  /** YYYY-MM-DD, the last day the goods may be sold. */
  expiryDate: string | null;
  qtyReceived: number;
  qtyRemaining: number;
  costPricePaise: number;
  /** Null = recorded before batch-level MRP tracking existed, falls back to the product's
   * current MRP. 0 = no printed MRP (loose goods), same convention as the product level. */
  mrpPaise: number | null;
  purchaseId: string | null;
  createdAt: string;
}

/** A batch with stock left that has expired or will within the window, for Inventory and alerts. */
export interface ExpiringBatchRow {
  batchId: string;
  productId: string;
  productName: string;
  uom: string;
  batchNo: string | null;
  expiryDate: string;
  qtyRemaining: number;
  costPricePaise: number;
  /** qtyRemaining at the batch's cost. */
  valuePaise: number;
  status: Exclude<ExpiryStatus, "ok">;
}
