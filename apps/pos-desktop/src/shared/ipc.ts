import type {
  AuditActivityEntry,
  Cart,
  CashSession,
  CreateSaleResult,
  Customer,
  CustomerBalance,
  CustomerLedgerEntry,
  GstRateRow,
  HsnSummaryRow,
  DraftBill,
  LabelDefaults,
  RepackHistoryEntry,
  PaymentInput,
  ProductSearchResult,
  PurchaseListRow,
  PurchasePriceSnapshot,
  PurchaseWithItems,
  RecentReturn,
  RecentSale,
  ReturnableSale,
  SalesReport,
  StockValuationRow,
  TopProductRow,
  StockMovementReason,
  Supplier,
  User,
  UserRole,
} from "@pos/types";
import type { ThemePreference } from "@pos/business-logic";
import type { ActivationInfo, ApproverCredentials, UiLanguage } from "@pos/types";
import type {
  DashboardSummary,
  DeadStockRow,
  ExpiringBatchRow,
  LowStockRow,
  MarginRow,
  ProductAdminRow,
  ProductDetailsInput,
  ProductForEdit,
  ProductPackRow,
  ProductPricesInput,
  ProfitReport,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderListRow,
  PurchaseOrderStatus,
  SlowMovingRow,
  StockAlert,
  StockBatch,
} from "@pos/types";

export const IPC_CHANNELS = {
  authLogin: "auth:login",
  sessionGetContext: "session:getContext",
  productsSearch: "products:search",
  productsListAll: "products:listAll",
  productsCreate: "products:create",
  catalogSeedDemo: "catalog:seedDemo",
  suppliersList: "suppliers:list",
  suppliersCreate: "suppliers:create",
  suppliersUpdate: "suppliers:update",
  suppliersSetActive: "suppliers:setActive",
  suppliersListProducts: "suppliers:listProducts",
  purchasesCreate: "purchases:create",
  purchasesListRecent: "purchases:listRecent",
  purchasesGet: "purchases:get",
  purchasesGetPriceSnapshots: "purchases:getPriceSnapshots",
  billingCreateSale: "billing:createSale",
  billingGetMrpCaps: "billing:getMrpCaps",
  billingSaveDraft: "billing:saveDraft",
  billingDeleteDraft: "billing:deleteDraft",
  billingListDrafts: "billing:listDrafts",
  inventoryAdjustStock: "inventory:adjustStock",
  inventoryGetLowStock: "inventory:getLowStock",
  inventoryGetStockLevels: "inventory:getStockLevels",
  inventoryRepack: "inventory:repack",
  inventoryRepackHistory: "inventory:repackHistory",
  labelsGetDefaults: "labels:getDefaults",
  labelsPrint: "labels:print",
  labelsGetSettings: "labels:getSettings",
  labelsSetSettings: "labels:setSettings",
  storeSettingsGetNegativeStockPolicy: "storeSettings:getNegativeStockPolicy",
  storeSettingsSetNegativeStockPolicy: "storeSettings:setNegativeStockPolicy",
  storeSettingsGetReceiptLanguage: "storeSettings:getReceiptLanguage",
  storeSettingsSetReceiptLanguage: "storeSettings:setReceiptLanguage",
  customersSearch: "customers:search",
  customersCreate: "customers:create",
  customersUpdate: "customers:update",
  customersListRecent: "customers:listRecent",
  creditGetBalance: "credit:getBalance",
  creditListEntries: "credit:listEntries",
  creditListOutstanding: "credit:listOutstanding",
  creditRecordRepayment: "credit:recordRepayment",
  creditSetLimit: "credit:setLimit",
  cashSessionOpen: "cashSession:open",
  cashSessionGetOpen: "cashSession:getOpen",
  cashSessionSummary: "cashSession:summary",
  cashSessionClose: "cashSession:close",
  printerPrintReceipt: "printer:printReceipt",
  printerListPrinters: "printer:listPrinters",
  dashboardGetSummary: "dashboard:getSummary",
  salesListRecent: "sales:listRecent",
  returnsLookup: "returns:lookup",
  returnsCreate: "returns:create",
  returnsListRecent: "returns:listRecent",
  reportsSales: "reports:sales",
  reportsGst: "reports:gst",
  reportsHsn: "reports:hsn",
  reportsTopProducts: "reports:topProducts",
  reportsStockValuation: "reports:stockValuation",
  reportsExportCsv: "reports:exportCsv",
  usersListByStore: "users:listByStore",
  usersCreate: "users:create",
  auditList: "audit:list",
  backupRun: "backup:run",
  backupList: "backup:list",
  backupRestore: "backup:restore",

  // DEV1: staff, receipts, activation, screen language, crash reporting
  usersUpdate: "users:update",
  usersSetActive: "users:setActive",
  usersResetPassword: "users:resetPassword",
  usersChangeOwnPassword: "users:changeOwnPassword",
  printerPrintInvoiceA4: "printer:printInvoiceA4",
  printerSaveInvoicePdf: "printer:saveInvoicePdf",
  activationGetStatus: "activation:getStatus",
  activationActivate: "activation:activate",
  uiGetLanguage: "ui:getLanguage",
  uiSetLanguage: "ui:setLanguage",
  uiGetTheme: "ui:getTheme",
  uiSetTheme: "ui:setTheme",
  errorsReportRenderer: "errors:reportRenderer",
  errorsTakeLastCrash: "errors:takeLastCrash",
  /** Main → renderer push, not an invoke channel. */
  appErrorReported: "app:errorReported",
  debugCrashRenderer: "debug:crashRenderer",
  billingGetCustomer: "billing:getCustomer",

  // DEV2: product admin, batches, purchase orders, insights and alerts
  productsListAdmin: "products:listAdmin",
  productsGet: "products:get",
  productsUpdate: "products:update",
  productsChangePrices: "products:changePrices",
  productsSetActive: "products:setActive",
  productsCreateChild: "products:createChild",
  productsListChildren: "products:listChildren",
  productsRelinkChildPrice: "products:relinkChildPrice",
  batchesListExpiring: "batches:listExpiring",
  batchesListForProduct: "batches:listForProduct",
  batchesWriteOff: "batches:writeOff",
  storeSettingsGetBlockExpiredSale: "storeSettings:getBlockExpiredSale",
  storeSettingsSetBlockExpiredSale: "storeSettings:setBlockExpiredSale",
  purchaseOrdersList: "purchaseOrders:list",
  purchaseOrdersGet: "purchaseOrders:get",
  purchaseOrdersCreate: "purchaseOrders:create",
  purchaseOrdersUpdate: "purchaseOrders:update",
  purchaseOrdersPlace: "purchaseOrders:place",
  purchaseOrdersCancel: "purchaseOrders:cancel",
  purchaseOrdersReceive: "purchaseOrders:receive",
  reportsProfit: "reports:profit",
  reportsSlowMoving: "reports:slowMoving",
  reportsDeadStock: "reports:deadStock",
  reportsMargins: "reports:margins",
  reportsExpiry: "reports:expiry",
  alertsList: "alerts:list",
} as const;

export interface SessionContext {
  organizationId: string;
  storeId: string;
  deviceId: string;
  counterId: string;
  billNoPrefix: string;
  isFirstRun: boolean;
  /** Device activation, as the main process resolved it. */
  activation: ActivationInfo;
  /** A development run: developer-only tools (e.g. `window.api.debug`) exist. */
  isDevelopment: boolean;
}

export interface CashSessionSummary {
  session: CashSession | null;
  /** Cash taken at this counter since the session opened. */
  cashTakenPaise: number;
  /** What the drawer should hold: opening float + cash taken. */
  expectedPaise: number;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

export interface RendererErrorReport {
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  /** Where it was caught, e.g. "ErrorBoundary" or "unhandledrejection". */
  context?: string | null;
}

export interface LastCrashInfo {
  errorId: string;
  reason: string;
  at: string;
}

export interface SalePrintResponse {
  ok: boolean;
  error?: string;
  /** Where a PDF was saved. */
  path?: string;
  /** This copy was stamped "DUPLICATE COPY". */
  duplicate?: boolean;
}

export interface UpdateEmployeeInput {
  userId: string;
  actingUserId: string;
  displayName: string;
  role: UserRole;
}

export interface CreateEmployeeInput {
  storeId: string;
  actingUserId: string;
  username: string;
  password: string;
  displayName: string;
  role: UserRole;
}

/** Mirrors NegativeStockPolicy in business-logic; kept literal so this file stays types-only. */
export type NegativeStockPolicy = "allow" | "warn" | "block";

/** Mirrors ReceiptLanguage in business-logic; kept literal so this file stays types-only. */
export type ReceiptLanguage = "english" | "bilingual" | "tamil_first";

export interface ReportRequest {
  storeId: string;
  actingUserId: string;
  /** Inclusive ISO instant. */
  fromIso: string;
  /** Exclusive ISO instant — the start of the day after the range ends. */
  toIso: string;
}

/** The "take back items on this bill" payload for an exchange, sent as billingCreateSale's
 * optional 4th argument. `payoutMode` is null unless the return is worth more than the new
 * items (N < R) — that's the only case a payout mode is asked for at all. */
export interface ExchangeReturnInput {
  originalSaleId: string;
  lines: Array<{ saleItemId: string; qty: number }>;
  reason: string | null;
  payoutMode: "cash" | "upi" | "card" | "credit" | null;
}

export interface CreateReturnInput {
  storeId: string;
  counterId: string;
  saleId: string;
  userId: string;
  clientTxnId: string;
  reason: string | null;
  refundMode: "cash" | "upi" | "card" | "credit";
  /** Only the lines being sent back, with the quantity for each. */
  lines: Array<{ saleItemId: string; qty: number }>;
  /** A manager's credentials when the signed-in user can't approve refunds themselves. */
  approver?: ApproverCredentials | null;
}

export interface RecordRepaymentInput {
  storeId: string;
  customerId: string;
  userId: string;
  amountPaise: number;
  /** Credit is not a way to pay off credit. */
  paymentMode: "cash" | "upi" | "card";
  note: string | null;
}

export interface SupplierInput {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  address: string | null;
}

export interface PurchaseLineInput {
  productId: string;
  qty: number;
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
  /** Optional; every line opens a stock batch, with or without either one. */
  batchNo?: string | null;
  /** YYYY-MM-DD, the last day the goods may be sold. */
  expiryDate?: string | null;
  /** Printed MRP on the received packs; null/absent = no change. */
  mrpPaise?: number | null;
}

export interface CreatePurchaseInput {
  storeId: string;
  supplierId: string;
  userId: string;
  invoiceNo: string | null;
  invoiceDate: string;
  notes: string | null;
  updateCostPrice: boolean;
  lines: PurchaseLineInput[];
  /** Retry key: sending the same one twice records the receipt once. */
  clientTxnId?: string | null;
}

export interface CreateProductInput {
  storeId: string;
  /** Who is adding the product — recorded on the audit entry. */
  userId: string;
  name: string;
  nameTamil: string | null;
  shortCode: string | null;
  supplierId: string | null;
  uom: string;
  isWeighted: boolean;
  hsnCode: string | null;
  taxRatePercent: number;
  barcodes: string[];
  aliases: string[];
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Omit or null for no wholesale rate. */
  wholesalePricePaise?: number | null;
  isTaxInclusive: boolean;
  /** Stock level at or below which the product shows as low; 0 = not set. */
  reorderLevel?: number;
  /** Where the product sits in the shop; shown in the app only. */
  rackLocation?: string | null;
  /** Days a pack made in-store stays good; the default best-before when repacking. */
  shelfLifeDays?: number | null;
}

export interface CreateChildProductInput {
  parentProductId: string;
  name: string;
  nameTamil: string | null;
  /** How much of the parent's uom one unit of this child represents (1 for "1kg" of a
   * kg-priced parent, 0.5 for "500g"). */
  packQty: number;
  barcodes: string[];
  aliases: string[];
  /** Omit to start linked to the parent's price, deriving it from packQty. Given, the child
   * starts unlinked with exactly this price. */
  prices?: ProductPricesInput | null;
  reorderLevel?: number;
}

export interface RepackRequest {
  storeId: string;
  parentProductId: string;
  childProductId: string;
  /** How many of the child's own units to make, e.g. 20 for "make 20 packs of 1kg". */
  childQty: number;
  /** YYYY-MM-DD the packs were made; not in the future. */
  packedOn: string;
  /** YYYY-MM-DD best-before; the bulk stock's own expiry wins if it is earlier. */
  expiryDate: string | null;
}

export interface PrintLabelsRequest {
  storeId: string;
  productId: string;
  repackId: string | null;
  copies: number;
  packedOn: string | null;
  expiryDate: string | null;
  mrpPaise: number;
  salePricePaise: number;
  /** A4 sheets only: the 1-based position of the first label on the first sheet. */
  startAt?: number | undefined;
}

/** Mirrors LabelLayout in business-logic plus the printer; kept literal so this file stays types-only. */
export interface LabelSettings {
  /** Null = ask in the print window every time. */
  printerName: string | null;
  /** "roll" = label printer, one row per page; "a4" = sticker sheet on an ordinary printer. */
  paper: "roll" | "a4";
  columns: number;
  /** A4 only. */
  rows: number;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  /** A4 only: between rows, and the sheet's top and left margins. */
  rowGapMm: number;
  marginTopMm: number;
  marginLeftMm: number;
}

export interface StockAdjustmentInput {
  storeId: string;
  productId: string;
  userId: string;
  qtyAfter: number;
  reason: Extract<
    StockMovementReason,
    "manual_stock_in" | "adjustment_damaged" | "adjustment_missing" | "adjustment_correction" | "adjustment_expired"
  >;
  note: string | null;
  /** A manager's credentials when the signed-in user's role needs approval for stock corrections. */
  approver?: ApproverCredentials | null;
}

/** An IPC result for a request that may need a manager's approval first. */
export interface ApprovableResult {
  ok: boolean;
  error?: string;
  /** Ask for a manager and send the same request again with `approver`. */
  approvalRequired?: boolean;
}

export interface PurchaseOrderLineInput {
  productId: string;
  qtyOrdered: number;
  /** Per unit, tax-inclusive or -exclusive per the flag. */
  costPricePaise: number;
  taxRatePercent: number;
  isTaxInclusive: boolean;
}

export interface CreatePurchaseOrderInput {
  storeId: string;
  actingUserId: string;
  supplierId: string;
  expectedDate: string | null;
  notes: string | null;
  lines: PurchaseOrderLineInput[];
}

export interface UpdatePurchaseOrderInput {
  poId: string;
  actingUserId: string;
  expectedDate: string | null;
  notes: string | null;
  lines: PurchaseOrderLineInput[];
}

export interface ReceivePurchaseOrderInput {
  poId: string;
  actingUserId: string;
  /** Generate once per Receive attempt and resend it on retry. */
  clientTxnId: string;
  invoiceNo: string;
  invoiceDate: string;
  notes: string | null;
  updateCostPrice: boolean;
  lines: Array<{
    poItemId: string;
    qty: number;
    costPricePaise: number;
    batchNo?: string | null;
    expiryDate?: string | null;
    /** Printed MRP on the received packs; null/absent = no change. */
    mrpPaise?: number | null;
  }>;
}

export type ReportResult<T> = T | { ok: false; error: string };

export interface PosApi {
  auth: {
    /** `usingDefaultPassword`: signed in with the seeded admin / admin123. */
    login: (
      username: string,
      password: string,
    ) => Promise<{ ok: boolean; user?: User; error?: string; usingDefaultPassword?: boolean }>;
  };
  session: {
    getContext: () => Promise<SessionContext>;
  };
  products: {
    search: (storeId: string, query: string) => Promise<ProductSearchResult[]>;
    listAll: (storeId: string, limit?: number) => Promise<ProductSearchResult[]>;
    create: (input: CreateProductInput) => Promise<{ ok: boolean; productId?: string; error?: string }>;
    /** Products table for Inventory, active or not. Owner, manager, inventory staff. */
    listAdmin: (req: {
      storeId: string;
      actingUserId: string;
      query: string;
      includeInactive: boolean;
      limit: number;
    }) => Promise<ReportResult<ProductAdminRow[]>>;
    get: (productId: string, actingUserId: string) => Promise<ReportResult<ProductForEdit>>;
    update: (req: {
      productId: string;
      actingUserId: string;
      details: ProductDetailsInput;
    }) => Promise<{ ok: boolean; product?: ProductForEdit; error?: string }>;
    /** Owner or manager only. `changed` is false when the prices were already these. */
    changePrices: (req: {
      productId: string;
      actingUserId: string;
      prices: ProductPricesInput;
    }) => Promise<{ ok: boolean; changed?: boolean; error?: string }>;
    setActive: (req: {
      productId: string;
      actingUserId: string;
      isActive: boolean;
    }) => Promise<{ ok: boolean; error?: string }>;
    /** Makes a pack-size product from a bulk one, e.g. "Sugar 1kg" from "Sugar 50kg Bag". */
    createChild: (
      storeId: string,
      actingUserId: string,
      input: CreateChildProductInput,
    ) => Promise<{ ok: boolean; productId?: string; error?: string }>;
    /** Every pack size of a bulk product, for display on its own screen. */
    listChildren: (storeId: string, actingUserId: string, parentProductId: string) => Promise<ProductPackRow[]>;
    /** Owner or manager only. Turns a child's price link back on and recalculates it now. */
    relinkChildPrice: (
      productId: string,
      actingUserId: string,
    ) => Promise<{ ok: boolean; product?: ProductForEdit; error?: string }>;
  };
  catalog: {
    seedDemo: (
      storeId: string,
      userId: string,
    ) => Promise<{ ok: boolean; seeded?: boolean; productsCreated?: number; error?: string }>;
  };
  suppliers: {
    list: (storeId: string, includeInactive?: boolean) => Promise<Supplier[]>;
    /** `actingUserId` is re-checked in the main process and recorded on the audit entry. */
    create: (
      storeId: string,
      supplier: SupplierInput,
      actingUserId: string,
    ) => Promise<{ ok: boolean; supplier?: Supplier; error?: string }>;
    update: (
      supplierId: string,
      supplier: SupplierInput,
      actingUserId: string,
    ) => Promise<{ ok: boolean; supplier?: Supplier; error?: string }>;
    setActive: (
      supplierId: string,
      isActive: boolean,
      actingUserId: string,
    ) => Promise<{ ok: boolean; supplier?: Supplier; error?: string }>;
    listProducts: (
      supplierId: string,
    ) => Promise<Array<{ productId: string; name: string; shortCode: string | null }>>;
  };
  purchases: {
    create: (input: CreatePurchaseInput) => Promise<{ ok: boolean; purchaseId?: string; error?: string }>;
    listRecent: (storeId: string, limit: number) => Promise<PurchaseListRow[]>;
    get: (purchaseId: string) => Promise<PurchaseWithItems | undefined>;
    /** Current price + stock per product, so a receipt line's cost box seeds from the
     * product's own recorded cost — never its sale price. */
    getPriceSnapshots: (
      storeId: string,
      productIds: string[],
      actingUserId: string,
    ) => Promise<ReportResult<Record<string, PurchasePriceSnapshot>>>;
  };
  billing: {
    /**
     * `approver` is sent only on the resend after the approval dialog. `approvalRequired`
     * means a manager must approve (a below-cost discount); resend the same cart with it.
     * `mrpCaps` arrives alongside a refusal when a line priced above the printed MRP of the
     * stock it would draw from — the server writes nothing in that case, and the renderer
     * must lower the cart's prices with these caps and have the cashier re-confirm payment.
     */
    createSale: (
      cart: Cart,
      payments: PaymentInput[],
      approver?: ApproverCredentials | null,
      /** Set when the bill also takes back items from an earlier one (an exchange). */
      exchange?: ExchangeReturnInput | null,
    ) => Promise<{
      ok: boolean;
      result?: CreateSaleResult;
      error?: string;
      approvalRequired?: boolean;
      mrpCaps?: Record<string, number>;
      /** The exchange's return was no longer valid (e.g. already returned elsewhere) —
       * nothing was written; the new items on the cart are untouched. */
      returnInvalid?: boolean;
      /** The credit note written for the linked return, once the sale succeeds. */
      returnNo?: string;
    }>;
    saveDraft: (input: {
      storeId: string;
      counterId: string;
      deviceId: string;
      cart: Cart;
      label: string | null;
    }) => Promise<void>;
    deleteDraft: (clientTxnId: string) => Promise<void>;
    listDrafts: (deviceId: string) => Promise<DraftBill[]>;
    /** A customer of this store by id — for a restored bill that carries only the id. */
    getCustomer: (customerId: string) => Promise<Customer | undefined>;
    /** MRP price cap per product, for whichever of the given lines need one (qty > 0 only).
     * A product absent from the result has no cap known or needed. */
    getMrpCaps: (storeId: string, lines: Array<{ productId: string; qty: number }>) => Promise<Record<string, number>>;
  };
  inventory: {
    adjustStock: (input: StockAdjustmentInput) => Promise<ApprovableResult>;
    /** Active products out of stock, or at/below a set reorder level. */
    getLowStock: (storeId: string) => Promise<LowStockRow[]>;
    /** On-hand by product id. Every requested id is present; no stock row reads as 0. */
    getStockLevels: (storeId: string, productIds: string[]) => Promise<Record<string, number>>;
    /** Converts stock of a bulk product into stock of one of its pack-size children. */
    repack: (
      req: RepackRequest,
      actingUserId: string,
    ) => Promise<{ ok: true; repackId: string; batchNo: string } | { ok: false; error: string }>;
    /** Repacks where this product is the bulk parent or the pack made, newest first. */
    repackHistory: (
      storeId: string,
      actingUserId: string,
      productId: string,
    ) => Promise<RepackHistoryEntry[] | { ok: false; error: string }>;
  };
  labels: {
    getDefaults: (
      storeId: string,
      actingUserId: string,
      productId: string,
      repackId: string | null,
    ) => Promise<LabelDefaults | { ok: false; error: string }>;
    /** Prints on the label printer (or asks in the print window) and records the print only on success. */
    print: (
      req: PrintLabelsRequest,
      actingUserId: string,
    ) => Promise<{ ok: true; barcode: string; barcodeAssigned: boolean } | { ok: false; error: string }>;
    getSettings: () => Promise<LabelSettings>;
    /** Owner or manager only — re-checked in the main process. */
    setSettings: (settings: LabelSettings, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
  };
  storeSettings: {
    getNegativeStockPolicy: () => Promise<NegativeStockPolicy>;
    /** Owner or manager only — re-checked in the main process. */
    setNegativeStockPolicy: (
      policy: NegativeStockPolicy,
      actingUserId: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    getReceiptLanguage: () => Promise<ReceiptLanguage>;
    /** Owner or manager only — re-checked in the main process. */
    setReceiptLanguage: (language: ReceiptLanguage, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
    /** Whether billing refuses stock that is past its expiry date. Off by default. */
    getBlockExpiredSale: () => Promise<boolean>;
    /** Owner or manager only — re-checked in the main process. */
    setBlockExpiredSale: (enabled: boolean, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
  };
  customers: {
    search: (storeId: string, query: string) => Promise<Customer[]>;
    /** `actingUserId` is re-checked in the main process and recorded on the audit entry. */
    create: (
      storeId: string,
      customer: CustomerInput,
      actingUserId: string,
    ) => Promise<{ ok: boolean; customer?: Customer; error?: string }>;
    update: (
      customerId: string,
      customer: CustomerInput,
      actingUserId: string,
    ) => Promise<{ ok: boolean; customer?: Customer; error?: string }>;
    listRecent: (storeId: string, limit: number) => Promise<Customer[]>;
  };
  credit: {
    getBalance: (customerId: string) => Promise<number>;
    listEntries: (customerId: string, limit: number) => Promise<CustomerLedgerEntry[]>;
    listOutstanding: (storeId: string) => Promise<CustomerBalance[]>;
    recordRepayment: (input: RecordRepaymentInput) => Promise<{ ok: boolean; error?: string }>;
    /** Owner or manager only — re-checked in the main process. */
    setLimit: (
      customerId: string,
      creditLimitPaise: number,
      actingUserId: string,
    ) => Promise<{ ok: boolean; error?: string }>;
  };
  dashboard: {
    /** Profit fields are null unless the acting user can view reports (re-checked in the main process). */
    getSummary: (storeId: string, actingUserId: string) => Promise<ReportResult<DashboardSummary>>;
  };
  sales: {
    listRecent: (storeId: string, limit: number) => Promise<RecentSale[]>;
  };
  returns: {
    /** Looks up a completed bill by its printed number, with what is still returnable. */
    lookup: (storeId: string, billNo: string) => Promise<ReturnableSale | undefined>;
    /** `approvalRequired` means: ask for a manager and send the same request again with `approver`. */
    create: (
      input: CreateReturnInput,
    ) => Promise<{ ok: boolean; returnNo?: string; error?: string; approvalRequired?: boolean }>;
    listRecent: (storeId: string, limit: number) => Promise<RecentReturn[]>;
  };
  reports: {
    /** Every report takes the acting user, whose role is re-checked in the main process. */
    sales: (req: ReportRequest) => Promise<SalesReport | { ok: false; error: string }>;
    gst: (req: ReportRequest) => Promise<GstRateRow[] | { ok: false; error: string }>;
    hsn: (req: ReportRequest) => Promise<HsnSummaryRow[] | { ok: false; error: string }>;
    topProducts: (req: ReportRequest, limit: number) => Promise<TopProductRow[] | { ok: false; error: string }>;
    stockValuation: (
      storeId: string,
      actingUserId: string,
    ) => Promise<StockValuationRow[] | { ok: false; error: string }>;
    /** Opens a save dialog and writes the CSV. Returns the chosen path, or ok:false if cancelled. */
    exportCsv: (
      suggestedName: string,
      content: string,
    ) => Promise<{ ok: boolean; path?: string; error?: string }>;
    /** Estimate at the cost price in effect when each bill was made, returns netted. */
    profit: (req: ReportRequest) => Promise<ReportResult<ProfitReport>>;
    slowMoving: (
      req: { storeId: string; actingUserId: string },
      opts: { lookbackDays?: number; minCoverDays?: number },
    ) => Promise<ReportResult<SlowMovingRow[]>>;
    deadStock: (
      req: { storeId: string; actingUserId: string },
      opts: { days?: number },
    ) => Promise<ReportResult<DeadStockRow[]>>;
    margins: (storeId: string, actingUserId: string) => Promise<ReportResult<MarginRow[]>>;
    expiry: (storeId: string, actingUserId: string, withinDays: number) => Promise<ReportResult<ExpiringBatchRow[]>>;
  };
  users: {
    listByStore: (storeId: string) => Promise<User[]>;
    create: (input: CreateEmployeeInput) => Promise<{ ok: boolean; user?: User; error?: string }>;
    /** Every staff change re-checks the acting user and the rules in the main process. */
    update: (input: UpdateEmployeeInput) => Promise<{ ok: boolean; user?: User; error?: string }>;
    setActive: (input: {
      userId: string;
      actingUserId: string;
      isActive: boolean;
    }) => Promise<{ ok: boolean; user?: User; error?: string }>;
    resetPassword: (input: {
      userId: string;
      actingUserId: string;
      newPassword: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    changeOwnPassword: (input: {
      actingUserId: string;
      currentPassword: string;
      newPassword: string;
    }) => Promise<{ ok: boolean; error?: string }>;
  };
  cashSession: {
    open: (input: {
      storeId: string;
      counterId: string;
      userId: string;
      openingCashPaise: number;
    }) => Promise<{ ok: boolean; session?: CashSession; error?: string }>;
    getOpen: (counterId: string) => Promise<CashSession | undefined>;
    summary: (counterId: string) => Promise<CashSessionSummary>;
    close: (input: {
      id: string;
      /** Who counted the drawer. */
      userId: string;
      countedCashPaise: number;
      closingCashPaise: number;
    }) => Promise<{ ok: boolean; session?: CashSession; error?: string }>;
  };
  printer: {
    /**
     * The 80 mm receipt. The main process stamps "DUPLICATE COPY" on any copy after the first
     * and logs reprints; `duplicate` says which this was.
     */
    printReceipt: (saleId: string, actingUserId: string) => Promise<SalePrintResponse>;
    listPrinters: () => Promise<string[]>;
    /** GST invoice on A4 through the system print dialog. Same duplicate rule. */
    printInvoiceA4: (saleId: string, actingUserId: string) => Promise<SalePrintResponse>;
    /** GST invoice saved as an A4 PDF where the user picks. Same duplicate rule. */
    saveInvoicePdf: (saleId: string, actingUserId: string) => Promise<SalePrintResponse>;
  };
  audit: {
    /** Newest first. Owner or manager only — re-checked in the main process. */
    list: (
      actingUserId: string,
      options: { limit: number; beforeIso: string | null },
    ) => Promise<AuditActivityEntry[] | { ok: false; error: string }>;
  };
  backup: {
    run: () => Promise<{ ok: boolean; backup?: BackupFile; error?: string }>;
    list: () => Promise<BackupFile[]>;
    /** Replaces the live database and restarts the app — nothing returns on success. Owner only. */
    restore: (name: string, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
  };
  batches: {
    /** Expired batches, and those expiring within `withinDays`, with stock left. Any signed-in user. */
    listExpiring: (storeId: string, withinDays: number) => Promise<ExpiringBatchRow[]>;
    listForProduct: (productId: string) => Promise<StockBatch[]>;
    /** Takes the batch's remaining stock off the count. Inventory staff need a manager's approval. */
    writeOff: (req: {
      batchId: string;
      actingUserId: string;
      note: string | null;
      approver?: ApproverCredentials | null;
    }) => Promise<ApprovableResult & { qty?: number }>;
  };
  purchaseOrders: {
    list: (req: {
      storeId: string;
      actingUserId: string;
      status: PurchaseOrderStatus | null;
      limit: number;
    }) => Promise<ReportResult<PurchaseOrderListRow[]>>;
    get: (poId: string, actingUserId: string) => Promise<ReportResult<PurchaseOrderDetail>>;
    create: (input: CreatePurchaseOrderInput) => Promise<{ ok: boolean; order?: PurchaseOrder; error?: string }>;
    /** Drafts only. */
    update: (input: UpdatePurchaseOrderInput) => Promise<{ ok: boolean; order?: PurchaseOrder; error?: string }>;
    /** Owner or manager only. */
    place: (poId: string, actingUserId: string) => Promise<{ ok: boolean; order?: PurchaseOrder; error?: string }>;
    /** Owner or manager only. A part-received order is closed rather than cancelled. */
    cancel: (
      poId: string,
      actingUserId: string,
      reason: string | null,
    ) => Promise<{ ok: boolean; order?: PurchaseOrder; error?: string }>;
    receive: (input: ReceivePurchaseOrderInput) => Promise<{
      ok: boolean;
      order?: PurchaseOrder;
      purchaseId?: string;
      alreadyExisted?: boolean;
      error?: string;
    }>;
  };
  alerts: {
    /** Low-stock and expiry alerts for the store. Any signed-in user. */
    list: (storeId: string) => Promise<StockAlert[]>;
  };
  activation: {
    getStatus: () => Promise<ActivationInfo>;
    /** Verifies the key offline and, if it fits this device, stores it. No restart needed. */
    activate: (key: string) => Promise<{ ok: boolean; error?: string; activation?: ActivationInfo }>;
  };
  ui: {
    getLanguage: () => Promise<UiLanguage>;
    /** Any signed-in user; recorded in the activity log. */
    setLanguage: (language: UiLanguage, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
    /** A user's saved theme; the defaults for an unknown user. */
    getTheme: (userId: string) => Promise<ThemePreference>;
    /** Saves the acting user's OWN theme; any signed-in user; recorded in the activity log. */
    setTheme: (theme: ThemePreference, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
  };
  errors: {
    /** Logs an error the screen caught and returns its reference id. */
    report: (report: RendererErrorReport) => Promise<{ errorId?: string; ok?: false; error?: string }>;
    /** The last screen crash the app recovered from, once. */
    takeLastCrash: () => Promise<LastCrashInfo | null>;
    /** Main-process errors, as they are logged. Returns the unsubscribe function. */
    onMainError: (callback: (errorId: string) => void) => () => void;
  };
  /** Development builds only. */
  debug?: {
    crashRenderer: () => Promise<void>;
  };
}
