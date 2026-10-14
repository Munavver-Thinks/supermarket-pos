import { z } from "zod";

export const cartLineSchema = z.object({
  lineId: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().min(1),
  uom: z.string().min(1),
  qty: z.number().positive(),
  unitPricePaise: z.number().int().nonnegative(),
  isTaxInclusive: z.boolean(),
  taxRatePercent: z.number().min(0).max(100),
  discountPercent: z.number().min(0).max(100),
  discountFlatPaise: z.number().int().nonnegative(),
});

export const cartSchema = z.object({
  clientTxnId: z.string().uuid(),
  storeId: z.string().uuid(),
  counterId: z.string().min(1),
  userId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  lines: z.array(cartLineSchema).min(1),
  billDiscountPercent: z.number().min(0).max(100),
  billDiscountFlatPaise: z.number().int().nonnegative(),
  heldAt: z.string().nullable(),
});

export const paymentInputSchema = z.object({
  mode: z.enum(["cash", "upi", "card", "credit"]),
  amountPaise: z.number().int().positive(),
  refNo: z.string().nullable(),
  // Semantic validation (which leg may carry these, when they must appear together, the
  // khata/customer rules) belongs in business logic (cashTenderRejection) so the cashier gets
  // a clear message, not a generic zod failure — no .superRefine here.
  tenderedPaise: z.number().int().positive().nullable().optional(),
  changeAction: z.enum(["handback", "khata"]).nullable().optional(),
});

export const createSaleRequestSchema = z.object({
  cart: cartSchema,
  payments: z.array(paymentInputSchema).min(1),
});

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * A manager's credentials typed at the counter to approve one request. Defined up here,
 * before the request schemas that embed it — a const used above its definition is a
 * runtime error.
 */
export const approverCredentialsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * The one rule for any new password (new employee, reset, change). "Not the same as the
 * username" needs both fields, so it is checked where both are known (auth.ts).
 */
export const newPasswordSchema = z.string().min(6, "Password must be at least 6 characters").max(256);

export const createEmployeeRequestSchema = z.object({
  storeId: z.string().uuid(),
  /** Whoever is performing the action — their role is re-checked server-side. */
  actingUserId: z.string().uuid(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64)
    .regex(/^[a-z0-9._-]+$/, "Username can only use lowercase letters, numbers, dot, underscore or hyphen"),
  password: newPasswordSchema,
  displayName: z.string().min(1).max(100),
  role: z.enum(["owner", "manager", "cashier", "inventory_staff"]),
});

export const productSearchRequestSchema = z.object({
  storeId: z.string().uuid(),
  query: z.string().min(1).max(128),
});

/** Where the product sits in the shop; a blank entry means "none". */
const rackLocationSchema = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .transform((v) => (v ? v : null));

/** Whole days a pack made in-store stays good. */
const shelfLifeDaysSchema = z.number().int().min(1).max(3650).nullable();

export const createProductRequestSchema = z.object({
  storeId: z.string().uuid(),
  /** Who is adding the product — recorded on the audit entry with its opening prices. */
  userId: z.string().uuid(),
  name: z.string().min(1).max(200),
  nameTamil: z.string().max(200).nullable(),
  shortCode: z.string().max(32).nullable(),
  supplierId: z.string().uuid().nullable(),
  uom: z.string().min(1).max(16),
  isWeighted: z.boolean(),
  hsnCode: z.string().max(16).nullable(),
  taxRatePercent: z.number().min(0).max(100),
  barcodes: z.array(z.string().min(1).max(64)),
  aliases: z.array(z.string().min(1).max(100)),
  mrpPaise: z.number().int().nonnegative(),
  salePricePaise: z.number().int().nonnegative(),
  costPricePaise: z.number().int().nonnegative(),
  /** Omit or null for no wholesale rate. */
  wholesalePricePaise: z.number().int().nonnegative().nullable().optional(),
  isTaxInclusive: z.boolean(),
  /** Stock level at or below which the product counts as low. 0 = not set. */
  reorderLevel: z.number().nonnegative().max(1_000_000).default(0),
  rackLocation: rackLocationSchema.optional(),
  shelfLifeDays: shelfLifeDaysSchema.optional(),
});

export const stockAdjustmentRequestSchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  userId: z.string().uuid(),
  // A counted stock level can't be below zero — this is the other way on-hand went negative.
  qtyAfter: z.number().nonnegative(),
  reason: z.enum([
    "manual_stock_in",
    "adjustment_damaged",
    "adjustment_missing",
    "adjustment_correction",
    "adjustment_expired",
  ]),
  note: z.string().max(500).nullable(),
  /** A manager's details, when the acting user's role needs approval for this. */
  approver: approverCredentialsSchema.nullable().optional(),
});

const supplierFieldsSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(32).nullable(),
  email: z.string().max(200).nullable(),
  address: z.string().max(500).nullable(),
  gstin: z.string().max(15).nullable(),
  notes: z.string().max(500).nullable(),
});

export const createSupplierRequestSchema = z.object({
  storeId: z.string().uuid(),
  supplier: supplierFieldsSchema,
  actingUserId: z.string().uuid(),
});

export const updateSupplierRequestSchema = z.object({
  supplierId: z.string().uuid(),
  supplier: supplierFieldsSchema,
  actingUserId: z.string().uuid(),
});

export const setSupplierActiveRequestSchema = z.object({
  supplierId: z.string().uuid(),
  isActive: z.boolean(),
  actingUserId: z.string().uuid(),
});

export const purchaseLineSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().positive(),
  costPricePaise: z.number().int().nonnegative(),
  taxRatePercent: z.number().min(0).max(100),
  isTaxInclusive: z.boolean(),
  /** Optional batch details; every line opens a stock batch, with or without either one. */
  batchNo: z.string().max(64).nullable().optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be a date (YYYY-MM-DD)")
    .nullable()
    .optional(),
  /** Printed MRP on the received packs. Positive only — the client sends null, never 0, for
   * "box left empty / no change", so 0 can never reach the server as a real MRP. */
  mrpPaise: z.number().int().positive().nullable().optional(),
});

export const createPurchaseRequestSchema = z.object({
  storeId: z.string().uuid(),
  supplierId: z.string().uuid(),
  userId: z.string().uuid(),
  invoiceNo: z.string().max(64).nullable(),
  invoiceDate: z.string().min(1).max(32),
  notes: z.string().max(500).nullable(),
  updateCostPrice: z.boolean(),
  lines: z.array(purchaseLineSchema).min(1),
  /** Retry key; optional so older callers still validate. */
  clientTxnId: z.string().uuid().nullable().optional(),
});

export const purchasePriceSnapshotRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).min(1).max(500),
});

export const auditListRequestSchema = z.object({
  actingUserId: z.string().uuid(),
  limit: z.number().int().positive().max(200),
  beforeIso: z.string().datetime().nullable(),
});

export const setNegativeStockPolicyRequestSchema = z.object({
  policy: z.enum(["allow", "warn", "block"]),
  actingUserId: z.string().uuid(),
});

export const setReceiptLanguageRequestSchema = z.object({
  language: z.enum(["english", "bilingual", "tamil_first"]),
  actingUserId: z.string().uuid(),
});

export const setUiLanguageRequestSchema = z.object({
  language: z.enum(["en", "ta"]),
  actingUserId: z.string().uuid(),
});

export const themePreferenceSchema = z
  .object({
    set: z.enum(["calm", "vivid"]),
    mode: z.enum(["day", "night", "auto"]),
    highContrast: z.boolean(),
  })
  .strict();

export const setUiThemeRequestSchema = z.object({
  theme: themePreferenceSchema,
  actingUserId: z.string().uuid(),
});

export const getUiThemeRequestSchema = z.object({
  userId: z.string().uuid(),
});

const customerFieldsSchema =z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(32).nullable(),
  address: z.string().max(500).nullable(),
});

export const createCustomerRequestSchema = z.object({
  storeId: z.string().uuid(),
  customer: customerFieldsSchema,
  actingUserId: z.string().uuid(),
});

export const updateCustomerRequestSchema = z.object({
  customerId: z.string().uuid(),
  customer: customerFieldsSchema,
  actingUserId: z.string().uuid(),
});

export const stockLevelsRequestSchema = z.object({
  storeId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).max(500),
});

export const reportRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  fromIso: z.string().datetime(),
  toIso: z.string().datetime(),
});

export const returnLineSchema = z.object({
  saleItemId: z.string().uuid(),
  qty: z.number().positive(),
});

export const createReturnRequestSchema = z.object({
  storeId: z.string().uuid(),
  counterId: z.string().min(1),
  saleId: z.string().uuid(),
  userId: z.string().uuid(),
  clientTxnId: z.string().uuid(),
  reason: z.string().max(200).nullable(),
  // "exchange" is never accepted here — it's set only internally by the exchange path
  // (billingCreateSale), never by a direct caller of the standalone returns:create channel.
  refundMode: z.enum(["cash", "upi", "card", "credit"]),
  lines: z.array(returnLineSchema).min(1),
  approver: approverCredentialsSchema.nullable().optional(),
});

/** An exchange's return leg: which earlier bill, what's coming back off it, and (only when
 * the return is worth more than the new items) how the leftover payout should be made. */
export const exchangeReturnRequestSchema = z.object({
  originalSaleId: z.string().uuid(),
  lines: z.array(returnLineSchema).min(1),
  reason: z.string().max(200).nullable(),
  payoutMode: z.enum(["cash", "upi", "card", "credit"]).nullable(),
});

/** Same cart as a plain sale, but payments may be empty — an exchange where the return is
 * worth more than the new items (N < R) takes no payment at all, it only pays out. */
export const createExchangeSaleRequestSchema = z.object({
  cart: cartSchema,
  payments: z.array(paymentInputSchema).max(4),
});

export const recordRepaymentRequestSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid(),
  userId: z.string().uuid(),
  // A zero repayment would write a ledger entry that changes nothing.
  amountPaise: z.number().int().positive(),
  // Credit is not a way to pay off credit.
  paymentMode: z.enum(["cash", "upi", "card"]),
  note: z.string().max(200).nullable(),
});

export const setCreditLimitRequestSchema = z.object({
  customerId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  /** 0 means no limit. */
  creditLimitPaise: z.number().int().nonnegative(),
});

export const openCashSessionRequestSchema = z.object({
  storeId: z.string().uuid(),
  counterId: z.string().min(1),
  userId: z.string().uuid(),
  openingCashPaise: z.number().int().nonnegative(),
});

export const closeCashSessionRequestSchema = z.object({
  id: z.string().uuid(),
  /** Who counted the drawer — may not be whoever opened it. */
  userId: z.string().uuid(),
  /** What the drawer should hold: opening float + cash taken. */
  closingCashPaise: z.number().int(),
  /** What was actually counted. */
  countedCashPaise: z.number().int().nonnegative(),
});

export const saveDraftBillRequestSchema = z.object({
  storeId: z.string().uuid(),
  counterId: z.string().min(1),
  deviceId: z.string().uuid(),
  cart: cartSchema,
  label: z.string().max(100).nullable(),
});

// ---- DEV1: staff management ----

const staffRoleSchema = z.enum(["owner", "manager", "cashier", "inventory_staff"]);

export const updateEmployeeRequestSchema = z.object({
  userId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(100),
  role: staffRoleSchema,
});

export const setEmployeeActiveRequestSchema = z.object({
  userId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  isActive: z.boolean(),
});

export const resetPasswordRequestSchema = z.object({
  userId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  newPassword: newPasswordSchema,
});

export const changeOwnPasswordRequestSchema = z.object({
  actingUserId: z.string().uuid(),
  currentPassword: z.string().min(1).max(256),
  newPassword: newPasswordSchema,
});

// ---- DEV2: products, batches, purchase orders, insights ----

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

export const listProductsAdminRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  query: z.string().max(128),
  includeInactive: z.boolean(),
  limit: z.number().int().positive().max(500),
});

export const productDetailsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameTamil: z.string().trim().max(200).nullable(),
  shortCode: z.string().trim().max(32).nullable(),
  supplierId: z.string().uuid().nullable(),
  uom: z.string().trim().min(1).max(16),
  isWeighted: z.boolean(),
  hsnCode: z.string().trim().max(16).nullable(),
  taxRatePercent: z.number().min(0).max(100),
  barcodes: z.array(z.string().trim().min(1).max(64)).max(20),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20),
  reorderLevel: z.number().nonnegative().max(1_000_000),
  rackLocation: rackLocationSchema,
  shelfLifeDays: shelfLifeDaysSchema,
});

export const updateProductRequestSchema = z.object({
  productId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  details: productDetailsSchema,
});

export const changeProductPricesRequestSchema = z.object({
  productId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  prices: z
    .object({
      mrpPaise: z.number().int().nonnegative(),
      salePricePaise: z.number().int().nonnegative(),
      costPricePaise: z.number().int().nonnegative(),
      /** Omit or null for no wholesale rate. */
      wholesalePricePaise: z.number().int().nonnegative().nullable().optional(),
      isTaxInclusive: z.boolean(),
    })
    // Selling above the printed MRP isn't allowed. Loose goods with no MRP (0) are exempt.
    .refine((p) => p.mrpPaise === 0 || p.salePricePaise <= p.mrpPaise, {
      message: "Sale price can't be more than the MRP",
    })
    .refine((p) => p.mrpPaise === 0 || !p.wholesalePricePaise || p.wholesalePricePaise <= p.mrpPaise, {
      message: "Wholesale price can't be more than the MRP",
    }),
});

export const setProductActiveRequestSchema = z.object({
  productId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  isActive: z.boolean(),
});

const packPricesSchema = z
  .object({
    mrpPaise: z.number().int().nonnegative(),
    salePricePaise: z.number().int().nonnegative(),
    costPricePaise: z.number().int().nonnegative(),
    /** Omit or null for no wholesale rate. */
    wholesalePricePaise: z.number().int().nonnegative().nullable().optional(),
    isTaxInclusive: z.boolean(),
  })
  .refine((p) => p.mrpPaise === 0 || p.salePricePaise <= p.mrpPaise, {
    message: "Sale price can't be more than the MRP",
  });

export const createChildProductRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  parentProductId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  nameTamil: z.string().trim().max(200).nullable(),
  packQty: z.number().positive(),
  barcodes: z.array(z.string().trim().min(1).max(64)).max(20),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20),
  /** Omit to start linked to the parent's price; given, the child starts unlinked. */
  prices: packPricesSchema.nullable().optional(),
  reorderLevel: z.number().nonnegative().max(1_000_000).default(0),
});

export const listProductChildrenRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  parentProductId: z.string().uuid(),
});

export const relinkChildPriceRequestSchema = z.object({
  productId: z.string().uuid(),
  actingUserId: z.string().uuid(),
});

export const repackRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  parentProductId: z.string().uuid(),
  childProductId: z.string().uuid(),
  childQty: z.number().positive(),
  packedOn: isoDateSchema,
  expiryDate: isoDateSchema.nullable(),
});

export const labelDefaultsRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  productId: z.string().uuid(),
  repackId: z.string().uuid().nullable(),
});

export const printLabelsRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  productId: z.string().uuid(),
  repackId: z.string().uuid().nullable(),
  copies: z.number().int().min(1).max(500),
  packedOn: isoDateSchema.nullable(),
  expiryDate: isoDateSchema.nullable(),
  mrpPaise: z.number().int().nonnegative(),
  salePricePaise: z.number().int().nonnegative(),
  /** A4 sheets only: the 1-based position of the first label, to finish a partly used sheet. */
  startAt: z.number().int().min(1).max(180).default(1),
});

export const labelSettingsRequestSchema = z.object({
  actingUserId: z.string().uuid(),
  /** Null = ask in the print window every time. */
  printerName: z.string().trim().max(256).nullable(),
  paper: z.enum(["roll", "a4"]),
  columns: z.number().int().min(1).max(6),
  rows: z.number().int().min(1).max(30),
  widthMm: z.number().min(15).max(200),
  heightMm: z.number().min(10).max(150),
  gapMm: z.number().min(0).max(20),
  rowGapMm: z.number().min(0).max(20),
  marginTopMm: z.number().min(0).max(50),
  marginLeftMm: z.number().min(0).max(50),
});

export const repackHistoryRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  productId: z.string().uuid(),
});

export const writeOffBatchRequestSchema = z.object({
  batchId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  note: z.string().max(500).nullable(),
  approver: approverCredentialsSchema.nullable().optional(),
});

export const setBlockExpiredSaleRequestSchema = z.object({
  enabled: z.boolean(),
  actingUserId: z.string().uuid(),
});

export const purchaseOrderLineSchema = z.object({
  productId: z.string().uuid(),
  qtyOrdered: z.number().positive(),
  costPricePaise: z.number().int().nonnegative(),
  taxRatePercent: z.number().min(0).max(100),
  isTaxInclusive: z.boolean(),
});

export const createPurchaseOrderRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  supplierId: z.string().uuid(),
  expectedDate: isoDateSchema.nullable(),
  notes: z.string().max(500).nullable(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(500),
});

export const updatePurchaseOrderRequestSchema = z.object({
  poId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  expectedDate: isoDateSchema.nullable(),
  notes: z.string().max(500).nullable(),
  lines: z.array(purchaseOrderLineSchema).min(1).max(500),
});

export const purchaseOrderActionRequestSchema = z.object({
  poId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  reason: z.string().max(500).nullable().optional(),
});

export const receivePurchaseOrderRequestSchema = z.object({
  poId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  /** Retry key: a repeat returns the first receipt with no stock change. */
  clientTxnId: z.string().uuid(),
  invoiceNo: z.string().trim().min(1, "Enter the supplier's invoice number").max(64),
  invoiceDate: z.string().min(1).max(32),
  notes: z.string().max(500).nullable(),
  updateCostPrice: z.boolean(),
  lines: z
    .array(
      z.object({
        poItemId: z.string().uuid(),
        qty: z.number().positive(),
        /** Per unit as invoiced; the order's tax rate and inclusive flag apply. */
        costPricePaise: z.number().int().nonnegative(),
        batchNo: z.string().max(64).nullable().optional(),
        expiryDate: isoDateSchema.nullable().optional(),
        /** Printed MRP on the received packs; null/absent = no change. */
        mrpPaise: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1, "Enter at least one quantity received")
    .max(500),
});

export const mrpCapsRequestSchema = z.object({
  storeId: z.string().uuid(),
  lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().positive() })).min(1).max(500),
});

export const listPurchaseOrdersRequestSchema = z.object({
  storeId: z.string().uuid(),
  actingUserId: z.string().uuid(),
  status: z.enum(["draft", "ordered", "partially_received", "received", "cancelled", "closed"]).nullable(),
  limit: z.number().int().positive().max(500),
});

export const slowMovingOptionsSchema = z.object({
  lookbackDays: z.number().int().min(7).max(365).default(30),
  minCoverDays: z.number().int().min(1).max(3650).default(60),
});

export const deadStockOptionsSchema = z.object({
  days: z.number().int().min(7).max(3650).default(90),
});
