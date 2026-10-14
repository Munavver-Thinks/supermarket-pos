/** What the shelf-label dialog opens with. Dates are YYYY-MM-DD; money is integer paise. */
export interface LabelDefaults {
  productName: string;
  storeName: string;
  /** Null when the product has no barcode yet — one is assigned on the first print. */
  barcode: string | null;
  mrpPaise: number;
  salePricePaise: number;
  packedOn: string | null;
  expiryDate: string | null;
  rackLocation: string | null;
  qtyOnHand: number;
  uom: string;
  suggestedCopies: number;
}

/** One repack, with the bulk batches it drew from and how many labels have been printed for it. */
export interface RepackHistoryEntry {
  repackId: string;
  batchNo: string;
  createdAt: string;
  packedOn: string;
  expiryDate: string | null;
  parentName: string;
  childProductId: string;
  childName: string;
  childQty: number;
  parentQtyUsed: number;
  parentUom: string;
  userName: string;
  labelsPrinted: number;
  sources: Array<{ batchNo: string | null; qty: number; expiryDate: string | null }>;
}
