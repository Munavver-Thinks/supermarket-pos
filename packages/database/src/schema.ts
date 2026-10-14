import type { Generated } from "kysely";

/**
 * NOTE: this interface is written in camelCase on purpose. The Kysely connection
 * (see connection.ts) registers CamelCasePlugin, which expects the TS-side schema to be
 * camelCase and rewrites identifiers to snake_case only in the SQL it sends to SQLite.
 * The actual column/table names in the database are snake_case — see migrations/0001_init.ts.
 *
 * Timestamps are plain ISO strings and booleans are stored as SQLite integers (0/1) —
 * deliberately not wrapped in a custom `ColumnType`, since nesting a custom ColumnType
 * inside `Generated<>` breaks Kysely's select/insert type resolution.
 */

export interface OrganizationsTable {
  id: string;
  name: string;
  createdAt: Generated<string>;
}

export interface StoresTable {
  id: string;
  organizationId: string;
  name: string;
  address: string | null;
  gstin: string | null;
  stateCode: string | null;
  createdAt: Generated<string>;
}

export interface DevicesTable {
  id: string;
  storeId: string;
  name: string;
  activationKey: string;
  activatedAt: string | null;
}

export interface UsersTable {
  id: string;
  storeId: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: "owner" | "manager" | "cashier" | "inventory_staff";
  isActive: Generated<number>;
  createdAt: Generated<string>;
}

export interface AppSettingsTable {
  key: string;
  value: string;
}

export interface CategoriesTable {
  id: string;
  storeId: string;
  name: string;
  parentId: string | null;
}

export interface BrandsTable {
  id: string;
  storeId: string;
  name: string;
}

export interface SuppliersTable {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  isActive: Generated<number>;
  createdAt: Generated<string>;
}

export interface ProductsTable {
  id: string;
  storeId: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  categoryId: string | null;
  brandId: string | null;
  supplierId: string | null;
  uom: string;
  isWeighted: Generated<number>;
  hsnCode: string | null;
  taxRatePercent: number;
  isActive: Generated<number>;
  createdAt: Generated<string>;
  /** Set only on a pack-size product, e.g. "Sugar 1kg" pointing at "Sugar 50kg Bag". One level
   * only — a child's own parentProductId is always null, enforced in application code. */
  parentProductId: string | null;
  /** How much of the parent's uom one unit of this child represents (1 for "1kg", 0.5 for
   * "500g"). Null for anything that isn't a child. */
  packQty: number | null;
  /** Whether this child's price follows the parent's automatically. Meaningless for anything
   * that isn't a child. See productPacks.ts. */
  priceLinkedToParent: Generated<number>;
  /** Where the product sits in the shop ("B-3"); shown in the app only, never printed. */
  rackLocation: string | null;
  /** Days a pack made in-store stays good — the default best-before when repacking. */
  shelfLifeDays: number | null;
}

export interface ProductBarcodesTable {
  id: string;
  productId: string;
  barcode: string;
  uom: string;
}

export interface ProductAliasesTable {
  id: string;
  productId: string;
  alias: string;
  aliasNormalized: string;
}

export interface ProductPricesTable {
  id: string;
  productId: string;
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Null means no wholesale rate is set — the product just sells at salePricePaise, even on
   * a bill marked wholesale. Never a sentinel 0, which would mean "free". */
  wholesalePricePaise: number | null;
  isTaxInclusive: Generated<number>;
  effectiveFrom: Generated<string>;
  effectiveTo: string | null;
}

export interface InventoryTable {
  productId: string;
  storeId: string;
  qtyOnHand: number;
  reorderLevel: number;
  updatedAt: Generated<string>;
}

export interface StockLedgerTable {
  id: string;
  storeId: string;
  productId: string;
  qtyChange: number;
  reason: string;
  referenceType: string;
  referenceId: string;
  userId: string;
  createdAt: Generated<string>;
}

export interface StockAdjustmentsTable {
  id: string;
  storeId: string;
  productId: string;
  qtyBefore: number;
  qtyAfter: number;
  reason: string;
  note: string | null;
  userId: string;
  approvedByUserId: string | null;
  createdAt: Generated<string>;
}

export interface PurchasesTable {
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
  createdAt: Generated<string>;
  /** Set when the goods were received against a purchase order (migration 0009). */
  purchaseOrderId: string | null;
  /** Retry key for a receipt; null on purchases recorded before migration 0009. */
  clientTxnId: string | null;
}

export interface PurchaseItemsTable {
  id: string;
  purchaseId: string;
  productId: string;
  qty: number;
  costPricePaise: number;
  taxRatePercent: Generated<number>;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export interface CustomersTable {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  address: string | null;
  /** 0 means no limit has been set, not "no credit allowed". See migration 0004. */
  creditLimitPaise: Generated<number>;
  createdAt: Generated<string>;
}

export interface SaleReturnsTable {
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
  refundMode: "cash" | "upi" | "card" | "credit" | "exchange";
  createdAt: Generated<string>;
  /** Who signed off the refund. Null on returns written before migration 0006. */
  approvedByUserId: string | null;
  /** The new sale this return's value was set off against, when it's the return leg of an
   * exchange. Null for a standalone refund. See migration 0015. */
  exchangeSaleId: string | null;
  /** How much of refundPaise was absorbed into the linked sale rather than paid out. 0 for a
   * standalone refund. See migration 0015. */
  exchangePaise: Generated<number>;
}

export interface SaleReturnItemsTable {
  id: string;
  returnId: string;
  saleItemId: string;
  productId: string;
  qty: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export interface CustomerLedgerEntriesTable {
  id: string;
  storeId: string;
  customerId: string;
  entryType: "credit_sale" | "repayment" | "return_refund" | "opening_balance" | "write_off" | "change_to_khata";
  /** Signed, from the customer's side: positive increases what they owe. */
  amountPaise: number;
  saleId: string | null;
  paymentMode: string | null;
  note: string | null;
  userId: string;
  createdAt: Generated<string>;
}

export interface BillSequenceTable {
  counterId: string;
  financialYear: string;
  prefix: string;
  lastNumber: number;
}

export interface SalesTable {
  id: string;
  storeId: string;
  counterId: string;
  billNo: string;
  clientTxnId: string;
  userId: string;
  customerId: string | null;
  status: "completed" | "voided";
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  netPaise: number;
  createdAt: Generated<string>;
}

export interface SaleItemsTable {
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

export interface PaymentsTable {
  id: string;
  saleId: string;
  mode: "cash" | "upi" | "card" | "credit";
  amountPaise: number;
  refNo: string | null;
  /** See migration 0016. */
  tenderedPaise: number | null;
  /** See migration 0016. */
  changeAction: "handback" | "khata" | null;
  createdAt: Generated<string>;
}

export interface DraftBillsTable {
  clientTxnId: string;
  storeId: string;
  counterId: string;
  userId: string;
  deviceId: string;
  cartJson: string;
  label: string | null;
  updatedAt: Generated<string>;
}

export interface CashSessionsTable {
  id: string;
  storeId: string;
  counterId: string;
  userId: string;
  openingCashPaise: number;
  closingCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  openedAt: Generated<string>;
  closedAt: string | null;
}

export interface AuditLogsTable {
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
  createdAt: Generated<string>;
}

export interface ErrorLogsTable {
  id: string;
  errorId: string;
  storeId: string | null;
  userId: string | null;
  message: string;
  stack: string | null;
  context: string | null;
  createdAt: Generated<string>;
}

/** A breakdown of on-hand stock by arrival and expiry — never a second count. See migration 0008. */
export interface StockBatchesTable {
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
  /** YYYY-MM-DD the pack was made; set only on batches created by a repack. */
  packedOn: string | null;
  repackId: string | null;
  createdAt: Generated<string>;
}

/** One row per repack — the trace from a shelf pack back to its bulk stock. See migration 0017. */
export interface RepacksTable {
  id: string;
  storeId: string;
  parentProductId: string;
  childProductId: string;
  childQty: number;
  parentQtyUsed: number;
  batchNo: string;
  packedOn: string;
  expiryDate: string | null;
  userId: string;
  createdAt: Generated<string>;
}

export interface RepackSourcesTable {
  id: string;
  repackId: string;
  /** Null = the draw came from stock that was never in a batch. */
  parentBatchId: string | null;
  qty: number;
  expiryDate: string | null;
}

/** Append-only record of shelf labels printed. */
export interface LabelPrintsTable {
  id: string;
  storeId: string;
  productId: string;
  repackId: string | null;
  labelCount: number;
  barcode: string;
  packedOn: string | null;
  expiryDate: string | null;
  mrpPaise: number;
  salePricePaise: number;
  userId: string;
  createdAt: Generated<string>;
}

export interface PurchaseOrdersTable {
  id: string;
  storeId: string;
  supplierId: string;
  poNo: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled" | "closed";
  expectedDate: string | null;
  notes: string | null;
  totalPaise: number;
  createdBy: string;
  createdAt: Generated<string>;
  updatedAt: Generated<string>;
  orderedAt: string | null;
  closedAt: string | null;
}

export interface PurchaseOrderItemsTable {
  id: string;
  purchaseOrderId: string;
  productId: string;
  qtyOrdered: number;
  qtyReceived: Generated<number>;
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: number;
}

/** Every print or PDF of a bill, append-only. See migration 0007. */
export interface ReceiptPrintsTable {
  id: string;
  storeId: string;
  saleId: string;
  format: "receipt" | "a4" | "pdf";
  userId: string | null;
  printedAt: Generated<string>;
}

export interface Database {
  organizations: OrganizationsTable;
  stores: StoresTable;
  devices: DevicesTable;
  users: UsersTable;
  appSettings: AppSettingsTable;
  categories: CategoriesTable;
  brands: BrandsTable;
  suppliers: SuppliersTable;
  products: ProductsTable;
  productBarcodes: ProductBarcodesTable;
  productAliases: ProductAliasesTable;
  productPrices: ProductPricesTable;
  inventory: InventoryTable;
  stockLedger: StockLedgerTable;
  stockAdjustments: StockAdjustmentsTable;
  purchases: PurchasesTable;
  purchaseItems: PurchaseItemsTable;
  customers: CustomersTable;
  customerLedgerEntries: CustomerLedgerEntriesTable;
  saleReturns: SaleReturnsTable;
  saleReturnItems: SaleReturnItemsTable;
  billSequence: BillSequenceTable;
  sales: SalesTable;
  saleItems: SaleItemsTable;
  payments: PaymentsTable;
  draftBills: DraftBillsTable;
  cashSessions: CashSessionsTable;
  auditLogs: AuditLogsTable;
  errorLogs: ErrorLogsTable;
  stockBatches: StockBatchesTable;
  purchaseOrders: PurchaseOrdersTable;
  purchaseOrderItems: PurchaseOrderItemsTable;
  receiptPrints: ReceiptPrintsTable;
  repacks: RepacksTable;
  repackSources: RepackSourcesTable;
  labelPrints: LabelPrintsTable;
}
