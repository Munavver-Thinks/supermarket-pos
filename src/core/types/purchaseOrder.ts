export type PurchaseOrderStatus = "draft" | "ordered" | "partially_received" | "received" | "cancelled" | "closed";

/** What the shop asked a supplier for. Stock moves only when goods are received against it. */
export interface PurchaseOrder {
  id: string;
  storeId: string;
  supplierId: string;
  poNo: string;
  status: PurchaseOrderStatus;
  expectedDate: string | null;
  notes: string | null;
  /** Value of the order as placed, at the ordered cost. */
  totalPaise: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  orderedAt: string | null;
  closedAt: string | null;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  qtyOrdered: number;
  qtyReceived: number;
  /** Per unit, tax-inclusive or -exclusive per the flag — same convention as a purchase line. */
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
}

export interface PurchaseOrderListRow extends PurchaseOrder {
  supplierName: string;
  itemCount: number;
  /** Total of every goods receipt booked against this order so far. */
  receivedPaise: number;
}

export interface PurchaseOrderDetail {
  order: PurchaseOrder;
  supplierName: string;
  items: Array<PurchaseOrderItem & { productName: string; uom: string; qtyRemaining: number }>;
  /** Goods receipts booked against the order, oldest first. */
  receipts: Array<{
    purchaseId: string;
    invoiceNo: string | null;
    invoiceDate: string;
    totalPaise: number;
    createdAt: string;
  }>;
}
