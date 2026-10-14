export interface Supplier {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * A received supplier invoice (goods-in) — either a direct receipt or goods received against
 * a purchase order. What was ordered lives on the purchase order, not here.
 */
export interface Purchase {
  id: string;
  storeId: string;
  supplierId: string;
  invoiceNo: string | null;
  invoiceDate: string;
  notes: string | null;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  userId: string;
  createdAt: string;
  /** Set when received against a purchase order; absent or null for a direct receipt. */
  purchaseOrderId?: string | null;
  clientTxnId?: string | null;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  qty: number;
  costPricePaise: number;
  taxRatePercent: number;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

/** A purchase row joined with its supplier's name, for the purchases list. */
export interface PurchaseListRow extends Purchase {
  supplierName: string;
  itemCount: number;
}

export interface PurchaseWithItems {
  purchase: Purchase;
  supplierName: string;
  items: Array<PurchaseItem & { productName: string; uom: string }>;
}

/** Current price + stock snapshot for one product, fetched before editing a purchase/receipt
 * line so its cost box seeds from the product's actual cost — not its sale price. */
export interface PurchasePriceSnapshot {
  productId: string;
  costPricePaise: number;
  salePricePaise: number;
  wholesalePricePaise: number | null;
  /** The product's current MRP; 0 = no MRP recorded. */
  mrpPaise: number;
  isTaxInclusive: boolean;
  taxRatePercent: number;
  qtyOnHand: number;
}
