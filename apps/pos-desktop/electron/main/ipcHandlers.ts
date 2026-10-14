import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { app, dialog, ipcMain } from "electron";
import {
  BelowCostDiscountError,
  canChangeStoreSettings,
  canManageSuppliers,
  canViewAuditLog,
  capLinesAtMrp,
  computeCartTotals,
  computePurchaseTotals,
  computeReturnTotals,
  canViewReports,
  cashTenderRejection,
  creditPortionPaise,
  creditRejectionReason,
  findStockShortfalls,
  formatIndianCurrency,
  fuzzySearchProducts,
  InsufficientStockError,
  localDateIso,
  mrpRefusalText,
  NEGATIVE_STOCK_POLICY_KEY,
  normalizeSearchText,
  parseNegativeStockPolicy,
  parseReceiptLanguage,
  RECEIPT_LANGUAGE_KEY,
  rankProducts,
  ReturnQuantityError,
} from "@pos/business-logic";
import type { CartTotalsResult, ReturnLineInput, ReturnTotalsResult } from "@pos/business-logic";
import type { ReturnableSale } from "@pos/types";
import {
  auditLogRepo,
  cashSessionsRepo,
  customerLedgerRepo,
  customersRepo,
  draftBillsRepo,
  inventoryRepo,
  kiranaCatalogRepo,
  productsAdminRepo,
  productsRepo,
  purchasesRepo,
  reportsRepo,
  returnsRepo,
  salesRepo,
  settingsRepo,
  stockBatchesRepo,
  suppliersRepo,
  usersRepo,
  type Db,
} from "@pos/database";
import {
  approverCredentialsSchema,
  auditListRequestSchema,
  createCustomerRequestSchema,
  createEmployeeRequestSchema,
  createExchangeSaleRequestSchema,
  createProductRequestSchema,
  createPurchaseRequestSchema,
  createReturnRequestSchema,
  createSaleRequestSchema,
  createSupplierRequestSchema,
  closeCashSessionRequestSchema,
  exchangeReturnRequestSchema,
  loginRequestSchema,
  mrpCapsRequestSchema,
  openCashSessionRequestSchema,
  productSearchRequestSchema,
  purchasePriceSnapshotRequestSchema,
  recordRepaymentRequestSchema,
  reportRequestSchema,
  saveDraftBillRequestSchema,
  setCreditLimitRequestSchema,
  setNegativeStockPolicyRequestSchema,
  setReceiptLanguageRequestSchema,
  setSupplierActiveRequestSchema,
  stockAdjustmentRequestSchema,
  stockLevelsRequestSchema,
  updateCustomerRequestSchema,
  updateSupplierRequestSchema,
} from "@pos/validation";
import { z } from "zod";

import { IPC_CHANNELS } from "../shared/ipc.js";

import { resolveApproval } from "./approval.js";
import { createEmployee, login } from "./auth.js";
import { listBackups, restoreBackup, runBackup } from "./backup.js";
import { reportError } from "./errorReporting.js";
import { getStoreActor, safeHandle, UTF8_BOM, type HandlerContext } from "./ipc/common.js";
import { getActivationStatus } from "./activation.js";
import { listPrinters } from "./printer.js";
import { registerStaffHandlers } from "./ipc/staff.js";
import { printSaleReceipt, registerReceiptHandlers } from "./ipc/receipts.js";
import { registerBillingHandlers } from "./ipc/billing.js";
import { registerBatchHandlers } from "./ipc/batches.js";
import { registerInsightsHandlers } from "./ipc/insights.js";
import { isStoreSupplierId, productActor, productUserError, registerProductHandlers } from "./ipc/products.js";
import { purchaseOrderActor, registerPurchaseOrderHandlers } from "./ipc/purchaseOrders.js";
import { registerProductPackHandlers } from "./ipc/productPacks.js";
import { registerLabelHandlers } from "./ipc/labels.js";
import { registerUiSettingsHandlers } from "./ipc/uiSettings.js";

export type { HandlerContext } from "./ipc/common.js";

/**
 * Turns the renderer's "these lines, this much qty" request into the return engine's input
 * shape, filling in every rupee from the original bill — never from what the renderer sent.
 * Shared by the standalone returns:create handler and the exchange leg of billingCreateSale,
 * so both refuse the same way when a requested line isn't actually on the bill.
 */
function buildReturnEngineLines(
  sale: ReturnableSale,
  requested: Array<{ saleItemId: string; qty: number }>,
): { ok: true; lines: ReturnLineInput[] } | { ok: false; error: string } {
  const byId = new Map(sale.lines.map((l) => [l.saleItemId, l]));
  const lines: ReturnLineInput[] = [];
  for (const r of requested) {
    const original = byId.get(r.saleItemId);
    if (!original) return { ok: false, error: "That item is not on this bill." };
    lines.push({
      saleItemId: original.saleItemId,
      productId: original.productId,
      soldQty: original.soldQty,
      alreadyReturnedQty: original.alreadyReturnedQty,
      returnQty: r.qty,
      discountPaise: original.discountPaise,
      taxablePaise: original.taxablePaise,
      cgstPaise: original.cgstPaise,
      sgstPaise: original.sgstPaise,
      lineTotalPaise: original.lineTotalPaise,
    });
  }
  return { ok: true, lines };
}

export function registerIpcHandlers(ctx: HandlerContext): void {
  ipcMain.handle(
    IPC_CHANNELS.authLogin,
    safeHandle(ctx, IPC_CHANNELS.authLogin, async (db, username: string, password: string) => {
      const parsed = loginRequestSchema.parse({ username, password });
      return login(db, ctx.deviceConfig.storeId, parsed.username, parsed.password);
    }),
  );

  ipcMain.handle(IPC_CHANNELS.sessionGetContext, async () => ({
    organizationId: ctx.deviceConfig.organizationId,
    storeId: ctx.deviceConfig.storeId,
    deviceId: ctx.deviceConfig.deviceId,
    counterId: ctx.deviceConfig.counterId,
    billNoPrefix: ctx.deviceConfig.billNoPrefix,
    isFirstRun: false,
    // Resolved once at boot (see main/index.ts) and re-read after a successful activation —
    // never null in practice, but a fresh "developer" reading is a safe fallback if this is
    // ever invoked before that boot step runs.
    activation: getActivationStatus() ?? {
      status: "developer",
      requestCode: "",
      licenseId: null,
      storeName: null,
      issuedAt: null,
      reason: null,
    },
    isDevelopment: !app.isPackaged,
  }));

  ipcMain.handle(
    IPC_CHANNELS.productsSearch,
    safeHandle(ctx, IPC_CHANNELS.productsSearch, async (db, storeId: string, query: string) => {
      const parsed = productSearchRequestSchema.parse({ storeId, query });
      const normalized = normalizeSearchText(parsed.query);

      const barcodeHit = await productsRepo.findByBarcode(db, parsed.storeId, parsed.query.trim());
      if (barcodeHit) {
        return [
          {
            productId: barcodeHit.productId,
            name: barcodeHit.name,
            nameTamil: barcodeHit.nameTamil,
            uom: barcodeHit.uom,
            isWeighted: barcodeHit.isWeighted === 1,
            barcode: barcodeHit.barcode,
            salePricePaise: barcodeHit.salePricePaise,
            mrpPaise: barcodeHit.mrpPaise,
            wholesalePricePaise: barcodeHit.wholesalePricePaise,
            isTaxInclusive: barcodeHit.isTaxInclusive === 1,
            taxRatePercent: barcodeHit.taxRatePercent,
            stockOnHand: barcodeHit.stockOnHand,
            matchType: "barcode" as const,
            matchScore: 100,
          },
        ];
      }

      const shortCodeHit = await productsRepo.findByShortCode(db, parsed.storeId, parsed.query.trim());
      if (shortCodeHit) {
        return [
          {
            productId: shortCodeHit.productId,
            name: shortCodeHit.name,
            nameTamil: shortCodeHit.nameTamil,
            uom: shortCodeHit.uom,
            isWeighted: shortCodeHit.isWeighted === 1,
            barcode: shortCodeHit.barcode,
            salePricePaise: shortCodeHit.salePricePaise,
            mrpPaise: shortCodeHit.mrpPaise,
            wholesalePricePaise: shortCodeHit.wholesalePricePaise,
            isTaxInclusive: shortCodeHit.isTaxInclusive === 1,
            taxRatePercent: shortCodeHit.taxRatePercent,
            stockOnHand: shortCodeHit.stockOnHand,
            matchType: "short_code" as const,
            matchScore: 100,
          },
        ];
      }

      const candidates = await productsRepo.searchCandidates(db, parsed.storeId, normalized);
      const ranked = rankProducts(parsed.query, candidates);
      if (ranked.length > 0) {
        return ranked.slice(0, 20);
      }

      const allProducts = await productsRepo.getAllActiveForCache(db, parsed.storeId);
      return fuzzySearchProducts(parsed.query, allProducts);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsListAll,
    safeHandle(ctx, IPC_CHANNELS.productsListAll, async (db, storeId: string, limit?: number) => {
      const rows = await productsRepo.listForBrowse(db, storeId, limit);
      return rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        nameTamil: row.nameTamil,
        uom: row.uom,
        isWeighted: row.isWeighted === 1,
        barcode: row.barcode,
        salePricePaise: row.salePricePaise,
        mrpPaise: row.mrpPaise,
        wholesalePricePaise: row.wholesalePricePaise,
        isTaxInclusive: row.isTaxInclusive === 1,
        taxRatePercent: row.taxRatePercent,
        stockOnHand: row.stockOnHand,
        matchType: "browse" as const,
        matchScore: 0,
      }));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsCreate,
    safeHandle(ctx, IPC_CHANNELS.productsCreate, async (db, input: unknown) => {
      const { userId, ...product } = createProductRequestSchema.parse(input);
      // The id the screen sends is only a claim; the role comes from the database.
      const actor = await productActor(db, ctx, userId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (product.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }
      if (!(await isStoreSupplierId(db, ctx, product.supplierId))) {
        return { ok: false, error: "That supplier could not be found." };
      }
      try {
        const productId = await productsAdminRepo.createProduct(db, {
          ...product,
          audit: { userId: actor.id, deviceId: ctx.deviceConfig.deviceId },
        });
        return { ok: true, productId };
      } catch (error) {
        const message = productUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.catalogSeedDemo,
    safeHandle(ctx, IPC_CHANNELS.catalogSeedDemo, async (db, storeId: string, userId: string) => {
      try {
        const result = await kiranaCatalogRepo.seedKiranaCatalog(db, storeId, userId);
        return { ok: true, seeded: true, productsCreated: result.productsCreated };
      } catch (error) {
        // Store already has products (from an earlier seed, or real inventory) — a no-op,
        // not a failure, so re-clicking the "load demo data" button is always safe.
        if (error instanceof Error && error.message.includes("already has products")) {
          return { ok: true, seeded: false, productsCreated: 0 };
        }
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.suppliersList,
    safeHandle(ctx, IPC_CHANNELS.suppliersList, async (db, storeId: string, includeInactive?: boolean) => {
      return suppliersRepo.listSuppliers(db, storeId, includeInactive ?? false);
    }),
  );

  /**
   * Supplier details decide who purchases are booked against, so the acting user is re-read
   * from the database on every write rather than trusted from the screen that sent it.
   * Returns the actor, or the message to show.
   */
  async function supplierActor(db: Db, actingUserId: string): Promise<{ id: string } | { error: string }> {
    const actor = await usersRepo.getById(db, actingUserId);
    if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
      return { error: "You are not signed in to this store." };
    }
    if (!canManageSuppliers(actor.role)) {
      return { error: "Only an owner, manager or inventory staff can change suppliers." };
    }
    return { id: actor.id };
  }

  /** A supplier id from the renderer must belong to this store before anything is changed. */
  async function isStoreSupplier(db: Db, supplierId: string): Promise<boolean> {
    const existing = await suppliersRepo.getSupplier(db, supplierId);
    return existing !== undefined && existing.storeId === ctx.deviceConfig.storeId;
  }

  ipcMain.handle(
    IPC_CHANNELS.suppliersCreate,
    safeHandle(
      ctx,
      IPC_CHANNELS.suppliersCreate,
      async (db, storeId: unknown, supplier: unknown, actingUserId: unknown) => {
        const parsed = createSupplierRequestSchema.parse({ storeId, supplier, actingUserId });
        const actor = await supplierActor(db, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (parsed.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }

        // Audited inside the supplier write's own transaction.
        const created = await suppliersRepo.createSupplier(db, parsed.storeId, parsed.supplier, {
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
        });
        return { ok: true, supplier: created };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.suppliersUpdate,
    safeHandle(
      ctx,
      IPC_CHANNELS.suppliersUpdate,
      async (db, supplierId: unknown, supplier: unknown, actingUserId: unknown) => {
        const parsed = updateSupplierRequestSchema.parse({ supplierId, supplier, actingUserId });
        const actor = await supplierActor(db, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (!(await isStoreSupplier(db, parsed.supplierId))) {
          return { ok: false, error: "That supplier could not be found." };
        }

        const updated = await suppliersRepo.updateSupplier(db, parsed.supplierId, parsed.supplier, {
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
        });
        return { ok: true, supplier: updated };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.suppliersSetActive,
    safeHandle(
      ctx,
      IPC_CHANNELS.suppliersSetActive,
      async (db, supplierId: unknown, isActive: unknown, actingUserId: unknown) => {
        const parsed = setSupplierActiveRequestSchema.parse({ supplierId, isActive, actingUserId });
        const actor = await supplierActor(db, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (!(await isStoreSupplier(db, parsed.supplierId))) {
          return { ok: false, error: "That supplier could not be found." };
        }

        const updated = await suppliersRepo.setSupplierActive(db, parsed.supplierId, parsed.isActive, {
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
        });
        return { ok: true, supplier: updated };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.suppliersListProducts,
    safeHandle(ctx, IPC_CHANNELS.suppliersListProducts, async (db, supplierId: string) => {
      return suppliersRepo.listSupplierProducts(db, supplierId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchasesCreate,
    safeHandle(ctx, IPC_CHANNELS.purchasesCreate, async (db, input: unknown) => {
      const parsed = createPurchaseRequestSchema.parse(input);
      // Receiving goods raises stock and can rewrite cost prices, so the role is re-read.
      const actor = await purchaseOrderActor(db, ctx, parsed.userId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }
      const supplier = await suppliersRepo.getSupplier(db, parsed.supplierId);
      if (!supplier || supplier.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "That supplier could not be found." };
      }
      const { lines, totals } = computePurchaseTotals(parsed.lines);

      try {
        const purchase = await purchasesRepo.createPurchase(db, {
          storeId: parsed.storeId,
          supplierId: parsed.supplierId,
          invoiceNo: parsed.invoiceNo,
          invoiceDate: parsed.invoiceDate,
          notes: parsed.notes,
          userId: actor.id,
          lines,
          totals,
          updateCostPrice: parsed.updateCostPrice,
          deviceId: ctx.deviceConfig.deviceId,
          clientTxnId: parsed.clientTxnId ?? null,
        });
        return { ok: true, purchaseId: purchase.id };
      } catch (error) {
        // A re-entered invoice number is the user's mistake to correct, not a crash to log.
        if (error instanceof purchasesRepo.DuplicatePurchaseInvoiceError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchasesListRecent,
    safeHandle(ctx, IPC_CHANNELS.purchasesListRecent, async (db, storeId: string, limit: number) => {
      return purchasesRepo.listRecentPurchases(db, storeId, limit);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchasesGet,
    safeHandle(ctx, IPC_CHANNELS.purchasesGet, async (db, purchaseId: string) => {
      return purchasesRepo.getPurchaseWithItems(db, purchaseId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchasesGetPriceSnapshots,
    safeHandle(
      ctx,
      IPC_CHANNELS.purchasesGetPriceSnapshots,
      async (db, storeId: unknown, productIds: unknown, actingUserId: unknown) => {
        const parsed = purchasePriceSnapshotRequestSchema.parse({ storeId, productIds, actingUserId });
        const actor = await purchaseOrderActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false as const, error: actor.error };
        if (parsed.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false as const, error: "You are not signed in to this store." };
        }
        return purchasesRepo.getPriceSnapshots(db, parsed.storeId, parsed.productIds);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.billingCreateSale,
    safeHandle(
      ctx,
      IPC_CHANNELS.billingCreateSale,
      async (db, cart: unknown, payments: unknown, approver: unknown, exchange: unknown) => {
        // Set only for an "exchange" bill — one that also takes back items from an earlier
        // bill, whose value comes off this one (see returns.ts / sales.ts for the write path).
        const ex = exchangeReturnRequestSchema.nullable().optional().parse(exchange) ?? null;
        const parsed = ex
          ? createExchangeSaleRequestSchema.parse({ cart, payments })
          : createSaleRequestSchema.parse({ cart, payments });
        const approverCredentials = approverCredentialsSchema.nullable().optional().parse(approver) ?? null;

        // A retried click (or a resend after approval that already went through) gets the bill
        // already written, before approval, pricing or stock are looked at again.
        const alreadySaved = await db
          .selectFrom("sales")
          .selectAll()
          .where("clientTxnId", "=", parsed.cart.clientTxnId)
          .executeTakeFirst();
        if (alreadySaved) {
          if (alreadySaved.storeId !== ctx.deviceConfig.storeId) return { ok: false, error: "That bill could not be found." };
          return { ok: true, result: { sale: alreadySaved, alreadyExisted: true } };
        }

        // Whoever the cart names as cashier must be a signed-in user of this store — their role
        // decides whether a below-cost discount needs a manager.
        if (parsed.cart.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }
        const actor = await getStoreActor(db, ctx, parsed.cart.userId);
        if ("error" in actor) return { ok: false, error: actor.error };

        // A retried click on the exchange path: the return leg was already written (and so,
        // since both legs share one transaction, so was the sale) — but the sale wasn't caught
        // above because a race lost the clientTxnId lookup. Answered before anything else is
        // re-checked, same as the standalone returns handler.
        if (ex) {
          const existingReturn = await returnsRepo.findReturnByClientTxnId(db, parsed.cart.clientTxnId);
          if (existingReturn) {
            return {
              ok: false,
              returnInvalid: true,
              error: `This return was already recorded as credit note ${existingReturn.returnNo}. Take payment for the new items only.`,
            };
          }
        }

        const tenderReason = cashTenderRejection(parsed.payments, parsed.cart.customerId);
        if (tenderReason) return { ok: false, error: tenderReason };

        // Checked before anything is written, so credit is refused with a reason the cashier
        // can act on rather than failing deep inside the sale transaction.
        const creditPaise = creditPortionPaise(parsed.payments);
        if (creditPaise > 0) {
          const customer = parsed.cart.customerId
            ? await customersRepo.getById(db, parsed.cart.customerId)
            : undefined;
          const reason = creditRejectionReason({
            balancePaise: parsed.cart.customerId ? await customerLedgerRepo.getBalance(db, parsed.cart.customerId) : 0,
            creditLimitPaise: customer?.creditLimitPaise ?? 0,
            creditAmountPaise: creditPaise,
            customerId: parsed.cart.customerId,
          });
          if (reason) return { ok: false, error: reason };
        }

        const productIds = [...new Set(parsed.cart.lines.map((l) => l.productId))];
        const costPricePaiseByProduct = await productsRepo.getCostPrices(db, productIds);

        // A cashier can never charge more than what's printed on the specific units being
        // sold. Checked and corrected here, before anything is written — PaymentModal only
        // lets the cashier confirm when entered payments exactly equal the recorded total, so a
        // silent server-side price drop after the sale was written would make recorded payments
        // exceed the recorded total and overstate credit/khata. Refusing here, with the caps
        // the renderer needs to correct the cart, keeps that correction ahead of payment.
        const mrpCaps = await stockBatchesRepo.getMrpCapsForSale(
          db,
          parsed.cart.storeId,
          parsed.cart.lines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, qty: l.qty })),
          localDateIso(),
        );
        const { lowered } = capLinesAtMrp(parsed.cart.lines, mrpCaps);
        if (lowered.length > 0) {
          return { ok: false, error: mrpRefusalText(lowered), mrpCaps };
        }

        let computed: CartTotalsResult;
        let belowCostApproval: { approvedByUserId: string } | undefined;
        // The below-cost error from the first (allowBelowCost: false) attempt, kept only on
        // the exchange path — it's folded into the one sale_return approval ask below instead
        // of being asked for on its own (see Decision 8: one owner/manager approval covers
        // both, since canApprove doesn't distinguish by action).
        let belowCostError: BelowCostDiscountError | undefined;

        if (!ex) {
          try {
            computed = computeCartTotals(parsed.cart, {
              costPricePaiseByProduct,
              allowBelowCost: false,
            });
          } catch (error) {
            // A discount below cost is a decision for a manager, not a crash. Without this the
            // guard reaches the counter as "Something went wrong (ref: …)", which tells them
            // nothing about the discount they just typed.
            if (!(error instanceof BelowCostDiscountError)) throw error;

            const approval = await resolveApproval(db, {
              storeId: ctx.deviceConfig.storeId,
              actingUserId: actor.id,
              action: "below_cost_discount",
              approver: approverCredentials,
              deviceId: ctx.deviceConfig.deviceId,
            });
            if (!approval.ok) {
              // On the first ask the discount itself is the reason; after a try, why the manager
              // details were refused.
              const reason = approval.approvalRequired && !approverCredentials ? error.message : approval.error;
              return { ok: false, error: reason, approvalRequired: approval.approvalRequired };
            }
            belowCostApproval = { approvedByUserId: approval.approvedByUserId };
            computed = computeCartTotals(parsed.cart, { costPricePaiseByProduct, allowBelowCost: true });
          }
        } else {
          try {
            computed = computeCartTotals(parsed.cart, { costPricePaiseByProduct, allowBelowCost: false });
          } catch (error) {
            if (!(error instanceof BelowCostDiscountError)) throw error;
            belowCostError = error;
            computed = computeCartTotals(parsed.cart, { costPricePaiseByProduct, allowBelowCost: true });
          }
        }
        const { lines, totals } = computed;

        // The exchange path checks its own payable figure below; a plain bill has no such
        // check elsewhere, so it belongs here — amountPaise is always the applied figure
        // (never tenderedPaise), so an overpaid-in-cash bill still sums to exactly netPaise.
        if (!ex) {
          const totalEntered = parsed.payments.reduce((sum, p) => sum + p.amountPaise, 0);
          if (totalEntered !== totals.netPaise) {
            return {
              ok: false,
              error: `The amount paid doesn't match ${formatIndianCurrency(totals.netPaise)} due. Re-enter the payment.`,
            };
          }
        }

        // Exchange only: look up the original bill, work out the return, and apply the
        // netting rule (Decision 6) — N is this sale's own net, just computed above; R is the
        // return's refund, computed fresh from the original bill, never trusted from the client.
        let exchangeReturnForSale: salesRepo.CreateSaleInput["exchangeReturn"];
        if (ex) {
          const originalSale = await returnsRepo.getReturnableSaleById(db, parsed.cart.storeId, ex.originalSaleId);
          if (!originalSale) return { ok: false, returnInvalid: true, error: "That bill could not be found." };

          const built = buildReturnEngineLines(originalSale, ex.lines);
          if (!built.ok) return { ok: false, returnInvalid: true, error: built.error };

          let returnComputed: ReturnTotalsResult;
          try {
            returnComputed = computeReturnTotals(built.lines);
          } catch (error) {
            if (error instanceof ReturnQuantityError) return { ok: false, returnInvalid: true, error: error.message };
            throw error;
          }

          const net = totals.netPaise;
          const refund = returnComputed.totals.refundPaise;
          const exchangePaise = Math.min(net, refund);
          const payable = net - exchangePaise;
          const payout = refund - exchangePaise;

          if (payout === 0) {
            // net >= refund: the customer pays the difference through ordinary payments.
            const totalEntered = parsed.payments.reduce((sum, p) => sum + p.amountPaise, 0);
            if (totalEntered !== payable) {
              return {
                ok: false,
                error: `The amount paid doesn't match ${formatIndianCurrency(payable)} due after the return. Re-enter the payment.`,
              };
            }
          } else {
            // net < refund: nothing is paid; the cashier picks how the leftover is given back.
            if (parsed.payments.length > 0) {
              return { ok: false, error: "Payment isn't taken when the return is worth more than the new items." };
            }
            if (!ex.payoutMode) {
              return { ok: false, error: `Choose how to give the customer back ${formatIndianCurrency(payout)}.` };
            }
          }

          const refundMode = payout === 0 ? "exchange" : ex.payoutMode!;

          if (refundMode === "credit" && !originalSale.customerId) {
            return { ok: false, error: new returnsRepo.RefundToKhataWithoutCustomerError().message };
          }

          // One ask for the whole exchange: it covers the return (sale_return) and, if the new
          // items also need a below-cost approval, that too — canApprove is the same
          // owner/manager rule for every action, not action-specific (Decision 8).
          const approval = await resolveApproval(db, {
            storeId: ctx.deviceConfig.storeId,
            actingUserId: actor.id,
            action: "sale_return",
            approver: approverCredentials,
            deviceId: ctx.deviceConfig.deviceId,
          });
          if (!approval.ok) {
            const reason =
              approval.approvalRequired && !approverCredentials ? (belowCostError?.message ?? approval.error) : approval.error;
            return { ok: false, error: reason, approvalRequired: approval.approvalRequired };
          }
          belowCostApproval = belowCostError ? { approvedByUserId: approval.approvedByUserId } : belowCostApproval;

          exchangeReturnForSale = {
            originalSaleId: originalSale.saleId,
            returnNoPrefix: `${ctx.deviceConfig.billNoPrefix}-RET`,
            customerId: originalSale.customerId,
            reason: ex.reason,
            refundMode,
            exchangePaise,
            lines: returnComputed.lines,
            totals: returnComputed.totals,
            approvedByUserId: approval.approvedByUserId,
          };
        }

        const stockPolicy = parseNegativeStockPolicy(await settingsRepo.getSetting(db, NEGATIVE_STOCK_POLICY_KEY));

        let result: salesRepo.CreateSaleResult;
        try {
          result = await salesRepo.createSale(db, {
            storeId: parsed.cart.storeId,
            counterId: parsed.cart.counterId,
            billNoPrefix: ctx.deviceConfig.billNoPrefix,
            deviceId: ctx.deviceConfig.deviceId,
            userId: actor.id,
            customerId: parsed.cart.customerId,
            clientTxnId: parsed.cart.clientTxnId,
            lines,
            totals,
            payments: parsed.payments,
            belowCostApproval,
            exchangeReturn: exchangeReturnForSale,
            // Only "block" refuses. "allow" and "warn" both let the sale through — warn is shown
            // to the cashier in the cart, not enforced here. The check runs against stock read
            // inside the sale's transaction, never against a figure the renderer sent.
            checkStock:
              stockPolicy === "block"
                ? (onHand) => {
                    const shortfalls = findStockShortfalls(
                      lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty })),
                      onHand,
                    );
                    if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);
                  }
                : undefined,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) return { ok: false, error: error.message };
          if (error instanceof returnsRepo.ReturnNoLongerAvailableError) {
            return { ok: false, error: error.message, returnInvalid: true };
          }
          if (error instanceof returnsRepo.RefundToKhataWithoutCustomerError) {
            return { ok: false, error: error.message };
          }
          if (error instanceof customerLedgerRepo.ChangeToKhataWithoutCustomerError) {
            return { ok: false, error: error.message };
          }
          throw error;
        }

        if (!result.alreadyExisted) {
          await draftBillsRepo.deleteDraftBill(db, parsed.cart.clientTxnId);
        }

        return { ok: true, result, returnNo: result.exchangeReturnNo };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.billingSaveDraft,
    safeHandle(ctx, IPC_CHANNELS.billingSaveDraft, async (db, input: unknown) => {
      const parsed = saveDraftBillRequestSchema.parse(input);
      await draftBillsRepo.saveDraftBill(db, {
        storeId: parsed.storeId,
        counterId: parsed.counterId,
        userId: parsed.cart.userId,
        deviceId: parsed.deviceId,
        cart: parsed.cart,
        label: parsed.label,
      });
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.billingDeleteDraft,
    safeHandle(ctx, IPC_CHANNELS.billingDeleteDraft, async (db, clientTxnId: string) => {
      await draftBillsRepo.deleteDraftBill(db, clientTxnId);
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.billingListDrafts,
    safeHandle(ctx, IPC_CHANNELS.billingListDrafts, async (db, deviceId: string) => {
      return draftBillsRepo.listDraftBillsForDevice(db, deviceId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.billingGetMrpCaps,
    safeHandle(ctx, IPC_CHANNELS.billingGetMrpCaps, async (db, storeId: unknown, lines: unknown) => {
      const parsed = mrpCapsRequestSchema.parse({ storeId, lines });
      // Same openness as the existing stock-levels lookup — no role or approval check needed.
      if (parsed.storeId !== ctx.deviceConfig.storeId) return {};
      return stockBatchesRepo.getMrpCapsForSale(db, parsed.storeId, parsed.lines, localDateIso());
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.inventoryAdjustStock,
    safeHandle(ctx, IPC_CHANNELS.inventoryAdjustStock, async (db, input: unknown) => {
      const parsed = stockAdjustmentRequestSchema.parse(input);
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }
      const product = await productsAdminRepo.getProductForEdit(db, parsed.productId);
      if (!product || product.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "That product could not be found." };
      }

      // Re-reads the actor from the database, refuses roles that don't do stock work, and
      // asks for a manager when the actor can't approve a correction themselves.
      const approval = await resolveApproval(db, {
        storeId: ctx.deviceConfig.storeId,
        actingUserId: parsed.userId,
        action: "stock_adjustment",
        approver: parsed.approver ?? null,
        deviceId: ctx.deviceConfig.deviceId,
      });
      if (!approval.ok) {
        return { ok: false, error: approval.error, approvalRequired: approval.approvalRequired };
      }

      await inventoryRepo.recordStockAdjustment(db, {
        id: randomUUID(),
        ledgerId: randomUUID(),
        storeId: ctx.deviceConfig.storeId,
        productId: parsed.productId,
        qtyAfter: parsed.qtyAfter,
        reason: parsed.reason,
        note: parsed.note,
        userId: parsed.userId,
        approvedByUserId: approval.approvedByUserId,
        // Audited inside the adjustment's own transaction, with the count before and after.
        deviceId: ctx.deviceConfig.deviceId,
      });
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.inventoryGetLowStock,
    safeHandle(ctx, IPC_CHANNELS.inventoryGetLowStock, async (db, storeId: string) => {
      // Same definition as the dashboard count and the alerts (active products only).
      if (storeId !== ctx.deviceConfig.storeId) return [];
      return inventoryRepo.getLowStock(db, storeId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.inventoryGetStockLevels,
    safeHandle(ctx, IPC_CHANNELS.inventoryGetStockLevels, async (db, storeId: unknown, productIds: unknown) => {
      const parsed = stockLevelsRequestSchema.parse({ storeId, productIds });
      return inventoryRepo.getStockLevels(db, parsed.storeId, parsed.productIds);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsGetNegativeStockPolicy,
    safeHandle(ctx, IPC_CHANNELS.storeSettingsGetNegativeStockPolicy, async (db) => {
      return parseNegativeStockPolicy(await settingsRepo.getSetting(db, NEGATIVE_STOCK_POLICY_KEY));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsSetNegativeStockPolicy,
    safeHandle(
      ctx,
      IPC_CHANNELS.storeSettingsSetNegativeStockPolicy,
      async (db, policy: unknown, actingUserId: unknown) => {
        const parsed = setNegativeStockPolicyRequestSchema.parse({ policy, actingUserId });

        // Re-read from the database: a cashier able to switch blocking off would be setting
        // the rule meant to check them.
        const actor = await usersRepo.getById(db, parsed.actingUserId);
        if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }
        if (!canChangeStoreSettings(actor.role)) {
          return { ok: false, error: "Only an owner or manager can change this." };
        }

        await db.transaction().execute(async (trx) => {
          const before = parseNegativeStockPolicy(await settingsRepo.getSetting(trx, NEGATIVE_STOCK_POLICY_KEY));
          await settingsRepo.setSetting(trx, NEGATIVE_STOCK_POLICY_KEY, parsed.policy);
          await auditLogRepo.appendAuditLog(trx, {
            storeId: ctx.deviceConfig.storeId,
            userId: actor.id,
            deviceId: ctx.deviceConfig.deviceId,
            action: "setting_changed",
            tableName: "app_settings",
            recordId: NEGATIVE_STOCK_POLICY_KEY,
            oldValue: before,
            newValue: parsed.policy,
            reason: null,
          });
        });
        return { ok: true };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsGetReceiptLanguage,
    safeHandle(ctx, IPC_CHANNELS.storeSettingsGetReceiptLanguage, async (db) => {
      return parseReceiptLanguage(await settingsRepo.getSetting(db, RECEIPT_LANGUAGE_KEY));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsSetReceiptLanguage,
    safeHandle(
      ctx,
      IPC_CHANNELS.storeSettingsSetReceiptLanguage,
      async (db, language: unknown, actingUserId: unknown) => {
        const parsed = setReceiptLanguageRequestSchema.parse({ language, actingUserId });

        // Same rule as every store setting: re-read the actor rather than trust the renderer.
        const actor = await usersRepo.getById(db, parsed.actingUserId);
        if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }
        if (!canChangeStoreSettings(actor.role)) {
          return { ok: false, error: "Only an owner or manager can change this." };
        }

        await db.transaction().execute(async (trx) => {
          const before = parseReceiptLanguage(await settingsRepo.getSetting(trx, RECEIPT_LANGUAGE_KEY));
          await settingsRepo.setSetting(trx, RECEIPT_LANGUAGE_KEY, parsed.language);
          await auditLogRepo.appendAuditLog(trx, {
            storeId: ctx.deviceConfig.storeId,
            userId: actor.id,
            deviceId: ctx.deviceConfig.deviceId,
            action: "setting_changed",
            tableName: "app_settings",
            recordId: RECEIPT_LANGUAGE_KEY,
            oldValue: before,
            newValue: parsed.language,
            reason: null,
          });
        });
        return { ok: true };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.customersSearch,
    safeHandle(ctx, IPC_CHANNELS.customersSearch, async (db, storeId: string, query: string) => {
      return customersRepo.searchCustomers(db, storeId, query);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.customersCreate,
    safeHandle(
      ctx,
      IPC_CHANNELS.customersCreate,
      async (db, storeId: unknown, customer: unknown, actingUserId: unknown) => {
        const parsed = createCustomerRequestSchema.parse({ storeId, customer, actingUserId });
        const actor = await getStoreActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (parsed.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }

        // Audited inside the customer write's own transaction. Any active signed-in user may
        // add a customer — this is routine while billing, not a store control.
        const created = await customersRepo.createCustomer(
          db,
          { storeId: parsed.storeId, ...parsed.customer },
          { userId: actor.id, deviceId: ctx.deviceConfig.deviceId },
        );
        return { ok: true, customer: created };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.customersUpdate,
    safeHandle(
      ctx,
      IPC_CHANNELS.customersUpdate,
      async (db, customerId: unknown, customer: unknown, actingUserId: unknown) => {
        const parsed = updateCustomerRequestSchema.parse({ customerId, customer, actingUserId });
        const actor = await getStoreActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };

        const existing = await customersRepo.getById(db, parsed.customerId);
        if (!existing || existing.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "That customer could not be found." };
        }

        const updated = await customersRepo.updateCustomer(db, parsed.customerId, parsed.customer, {
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
        });
        return { ok: true, customer: updated };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.customersListRecent,
    safeHandle(ctx, IPC_CHANNELS.customersListRecent, async (db, storeId: string, limit: number) => {
      return customersRepo.listRecent(db, storeId, limit);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.creditGetBalance,
    safeHandle(ctx, IPC_CHANNELS.creditGetBalance, async (db, customerId: string) => {
      return customerLedgerRepo.getBalance(db, customerId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.creditListEntries,
    safeHandle(ctx, IPC_CHANNELS.creditListEntries, async (db, customerId: string, limit: number) => {
      return customerLedgerRepo.listEntries(db, customerId, limit);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.creditListOutstanding,
    safeHandle(ctx, IPC_CHANNELS.creditListOutstanding, async (db, storeId: string) => {
      return customerLedgerRepo.listOutstanding(db, storeId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.creditRecordRepayment,
    safeHandle(ctx, IPC_CHANNELS.creditRecordRepayment, async (db, input: unknown) => {
      const parsed = recordRepaymentRequestSchema.parse(input);
      await customerLedgerRepo.recordRepayment(db, {
        storeId: parsed.storeId,
        customerId: parsed.customerId,
        amountPaise: parsed.amountPaise,
        paymentMode: parsed.paymentMode,
        note: parsed.note,
        userId: parsed.userId,
        // Audited inside the repayment's own transaction.
        deviceId: ctx.deviceConfig.deviceId,
      });
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.creditSetLimit,
    safeHandle(
      ctx,
      IPC_CHANNELS.creditSetLimit,
      async (db, customerId: unknown, creditLimitPaise: unknown, actingUserId: unknown) => {
        const parsed = setCreditLimitRequestSchema.parse({ customerId, creditLimitPaise, actingUserId });

        // A credit limit decides how much a customer can walk out owing, so it isn't something
        // counter staff set for themselves or for someone they know.
        const actor = await usersRepo.getById(db, parsed.actingUserId);
        if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "You are not signed in to this store." };
        }
        if (!canChangeStoreSettings(actor.role)) {
          return { ok: false, error: "Only an owner or manager can set credit limits." };
        }

        const customer = await customersRepo.getById(db, parsed.customerId);
        if (!customer || customer.storeId !== ctx.deviceConfig.storeId) {
          return { ok: false, error: "That customer could not be found." };
        }

        await db.transaction().execute(async (trx) => {
          await customerLedgerRepo.setCreditLimit(trx, parsed.customerId, parsed.creditLimitPaise);
          await auditLogRepo.appendAuditLog(trx, {
            storeId: ctx.deviceConfig.storeId,
            userId: actor.id,
            deviceId: ctx.deviceConfig.deviceId,
            action: "credit_limit_changed",
            tableName: "customers",
            recordId: parsed.customerId,
            oldValue: { creditLimitPaise: customer.creditLimitPaise },
            newValue: { creditLimitPaise: parsed.creditLimitPaise },
            reason: null,
          });
        });
        return { ok: true };
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.salesListRecent,
    safeHandle(ctx, IPC_CHANNELS.salesListRecent, async (db, storeId: string, limit: number) => {
      return salesRepo.listRecent(db, storeId, limit);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.returnsLookup,
    safeHandle(ctx, IPC_CHANNELS.returnsLookup, async (db, storeId: string, billNo: string) => {
      return returnsRepo.getReturnableSale(db, storeId, billNo.trim());
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.returnsCreate,
    safeHandle(ctx, IPC_CHANNELS.returnsCreate, async (db, input: unknown) => {
      const parsed = createReturnRequestSchema.parse(input);

      // A retried click is answered with the credit note already written — before any
      // approval prompt, so the manager is never asked twice for one refund.
      const existing = await returnsRepo.findReturnByClientTxnId(db, parsed.clientTxnId);
      if (existing) {
        if (existing.storeId !== ctx.deviceConfig.storeId) return { ok: false, error: "That return could not be found." };
        return { ok: true, returnNo: existing.returnNo };
      }

      // The acting user is re-read, never taken from the request: a refund is money leaving
      // the drawer, and the role decides whether a manager must sign it off.
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }
      const actor = await getStoreActor(db, ctx, parsed.userId);
      if ("error" in actor) return { ok: false, error: actor.error };

      // The renderer sends only which lines and how many. Every rupee is re-read from the
      // original bill here, so a refund can never be larger than what was actually charged.
      const sale = await returnsRepo.getReturnableSaleById(db, parsed.storeId, parsed.saleId);
      if (!sale) return { ok: false, error: "That bill could not be found." };

      const built = buildReturnEngineLines(sale, parsed.lines);
      if (!built.ok) return { ok: false, error: built.error };

      let computed: ReturnTotalsResult;
      try {
        computed = computeReturnTotals(built.lines);
      } catch (error) {
        // Returning more than was sold is the user's mistake to correct, not a crash.
        if (error instanceof ReturnQuantityError) return { ok: false, error: error.message };
        throw error;
      }
      if (parsed.refundMode === "credit" && !sale.customerId) {
        return { ok: false, error: new returnsRepo.RefundToKhataWithoutCustomerError().message };
      }

      // Asked only once the return itself is valid, so a manager isn't called over for a
      // quantity the counter still has to fix. Nothing is written unless this passes.
      const approval = await resolveApproval(db, {
        storeId: ctx.deviceConfig.storeId,
        actingUserId: actor.id,
        action: "sale_return",
        approver: parsed.approver ?? null,
        deviceId: ctx.deviceConfig.deviceId,
      });
      if (!approval.ok) {
        return { ok: false, error: approval.error, approvalRequired: approval.approvalRequired };
      }

      try {
        const result = await returnsRepo.createReturn(db, {
          storeId: parsed.storeId,
          counterId: parsed.counterId,
          returnNoPrefix: `${ctx.deviceConfig.billNoPrefix}-RET`,
          saleId: parsed.saleId,
          customerId: sale.customerId,
          clientTxnId: parsed.clientTxnId,
          userId: actor.id,
          reason: parsed.reason,
          refundMode: parsed.refundMode,
          lines: computed.lines,
          totals: computed.totals,
          approvedByUserId: approval.approvedByUserId,
          // Audited inside the return's own transaction.
          deviceId: ctx.deviceConfig.deviceId,
        });

        return { ok: true, returnNo: result.saleReturn.returnNo };
      } catch (error) {
        if (error instanceof returnsRepo.RefundToKhataWithoutCustomerError) {
          return { ok: false, error: error.message };
        }
        if (error instanceof returnsRepo.ReturnNoLongerAvailableError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.returnsListRecent,
    safeHandle(ctx, IPC_CHANNELS.returnsListRecent, async (db, storeId: string, limit: number) => {
      return returnsRepo.listRecentReturns(db, storeId, limit);
    }),
  );

  /**
   * Reports carry cost prices and the day's takings, so the acting user's role is re-read
   * from the database on every call. Hiding the nav item is presentation; this is the control.
   */
  async function assertReportAccess(db: Db, storeId: string, actingUserId: string): Promise<string | null> {
    const actor = await usersRepo.getById(db, actingUserId);
    if (!actor || !actor.isActive || actor.storeId !== storeId) return "You are not signed in to this store.";
    if (!canViewReports(actor.role)) return "Reports are available to owners and managers.";
    return null;
  }

  ipcMain.handle(
    IPC_CHANNELS.reportsSales,
    safeHandle(ctx, IPC_CHANNELS.reportsSales, async (db, req: unknown) => {
      const parsed = reportRequestSchema.parse(req);
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return reportsRepo.getSalesReport(db, parsed.storeId, parsed);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsGst,
    safeHandle(ctx, IPC_CHANNELS.reportsGst, async (db, req: unknown) => {
      const parsed = reportRequestSchema.parse(req);
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return reportsRepo.getGstSummary(db, parsed.storeId, parsed);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsHsn,
    safeHandle(ctx, IPC_CHANNELS.reportsHsn, async (db, req: unknown) => {
      const parsed = reportRequestSchema.parse(req);
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return reportsRepo.getHsnSummary(db, parsed.storeId, parsed);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsTopProducts,
    safeHandle(ctx, IPC_CHANNELS.reportsTopProducts, async (db, req: unknown, limit: unknown) => {
      const parsed = reportRequestSchema.parse(req);
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return reportsRepo.getTopProducts(db, parsed.storeId, parsed, z.number().int().positive().max(200).parse(limit));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsStockValuation,
    safeHandle(ctx, IPC_CHANNELS.reportsStockValuation, async (db, storeId: string, actingUserId: string) => {
      const denied = await assertReportAccess(db, storeId, actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return reportsRepo.getStockValuation(db, storeId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsExportCsv,
    safeHandle(ctx, IPC_CHANNELS.reportsExportCsv, async (_db, suggestedName: unknown, content: unknown) => {
      const name = z.string().min(1).max(120).parse(suggestedName);
      const csv = z.string().parse(content);

      const result = await dialog.showSaveDialog({
        title: "Save report",
        // The dialog decides where this lands, so the renderer never names a path itself.
        defaultPath: name.replace(/[^\w.-]/g, "_"),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, error: "Export cancelled." };

      // A byte-order mark, so Excel opens the file as UTF-8 and Tamil product names survive
      // instead of arriving as mojibake. Written as an escape — a literal BOM in source is
      // invisible and easy to delete by accident.
      await fs.writeFile(result.filePath, UTF8_BOM + csv, "utf8");
      return { ok: true, path: result.filePath };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.usersListByStore,
    safeHandle(ctx, IPC_CHANNELS.usersListByStore, async (db, storeId: string) => {
      return usersRepo.listByStore(db, storeId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.backupRun,
    safeHandle(ctx, IPC_CHANNELS.backupRun, async (db) => {
      const backup = await runBackup(db);
      return { ok: true, backup };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.backupList,
    safeHandle(ctx, IPC_CHANNELS.backupList, async () => listBackups()),
  );

  ipcMain.handle(
    IPC_CHANNELS.backupRestore,
    safeHandle(ctx, IPC_CHANNELS.backupRestore, async (db, rawName: unknown, rawActingUserId: unknown) => {
      const name = z.string().min(1).max(200).parse(rawName);
      const actingUserId = z.string().uuid().parse(rawActingUserId);

      // Restoring discards live data, so the role is re-checked here rather than trusted
      // from the renderer that hid the button.
      const actor = await usersRepo.getById(db, actingUserId);
      if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId || actor.role !== "owner") {
        return { ok: false, error: "Only an owner can restore a backup." };
      }

      // Confirmed in the main process on purpose: this discards live data, so the prompt
      // must not be something the renderer can skip past.
      const { response } = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Restore and restart", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Restore backup",
        message: `Replace the current data with the backup "${name}"?`,
        detail:
          "Everything recorded since that backup — bills, stock changes, purchases — will be lost. " +
          "The current database is kept as a copy in the backups folder, and the app will restart.",
      });
      if (response !== 0) {
        return { ok: false, error: "Restore cancelled." };
      }

      // Nothing may hold the file open while it is replaced.
      await db.destroy();
      try {
        // Records who restored what in a marker the next boot writes into the restored
        // database — an entry written now would be wiped with the file it was written to.
        restoreBackup(name, { id: actor.id, displayName: actor.displayName });
      } catch (error) {
        // The database is already closed, so the app can't carry on either way; say what
        // happened and restart onto whatever data is on disk. Not routed through safeHandle's
        // catch, which would try to log into the closed database.
        reportError(undefined, { storeId: ctx.deviceConfig.storeId, userId: actor.id, context: "backup:restore" }, error);
        dialog.showErrorBox(
          "Restore failed",
          `The backup could not be restored: ${error instanceof Error ? error.message : String(error)}\n\n` +
            "The app will restart. If your data looks wrong, the data from before the restore is kept " +
            "as a pos-replaced file in the backups folder.",
        );
      }

      app.relaunch();
      app.exit(0);
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.auditList,
    safeHandle(ctx, IPC_CHANNELS.auditList, async (db, actingUserId: unknown, options: unknown) => {
      const opts = (typeof options === "object" && options !== null ? options : {}) as Record<string, unknown>;
      const parsed = auditListRequestSchema.parse({ actingUserId, limit: opts.limit, beforeIso: opts.beforeIso });

      const actor = await usersRepo.getById(db, parsed.actingUserId);
      if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "You are not signed in to this store." };
      }
      if (!canViewAuditLog(actor.role)) {
        return { ok: false as const, error: "The activity log is available to owners and managers." };
      }

      return auditLogRepo.listAuditLog(db, ctx.deviceConfig.storeId, {
        limit: parsed.limit,
        beforeIso: parsed.beforeIso ?? undefined,
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.usersCreate,
    safeHandle(ctx, IPC_CHANNELS.usersCreate, async (db, input: unknown) => {
      const parsed = createEmployeeRequestSchema.parse(input);
      return createEmployee(db, { ...parsed, deviceId: ctx.deviceConfig.deviceId });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.cashSessionOpen,
    safeHandle(ctx, IPC_CHANNELS.cashSessionOpen, async (db, input: unknown) => {
      const parsed = openCashSessionRequestSchema.parse(input);
      const alreadyOpen = await cashSessionsRepo.getOpenCashSession(db, parsed.counterId);
      if (alreadyOpen) {
        return { ok: false, error: "This counter already has an open cash session." };
      }
      const session = await db.transaction().execute(async (trx) => {
        const opened = await cashSessionsRepo.openCashSession(trx, parsed);
        await auditLogRepo.appendAuditLog(trx, {
          storeId: parsed.storeId,
          userId: parsed.userId,
          deviceId: ctx.deviceConfig.deviceId,
          action: "cash_session_opened",
          tableName: "cash_sessions",
          recordId: opened.id,
          oldValue: null,
          newValue: { counterId: parsed.counterId, openingCashPaise: parsed.openingCashPaise },
          reason: null,
        });
        return opened;
      });
      return { ok: true, session };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.cashSessionGetOpen,
    safeHandle(ctx, IPC_CHANNELS.cashSessionGetOpen, async (db, counterId: string) => {
      return cashSessionsRepo.getOpenCashSession(db, counterId);
    }),
  );

  /** The open session plus the figures the drawer is counted against at close. */
  ipcMain.handle(
    IPC_CHANNELS.cashSessionSummary,
    safeHandle(ctx, IPC_CHANNELS.cashSessionSummary, async (db, counterId: string) => {
      const session = await cashSessionsRepo.getOpenCashSession(db, counterId);
      if (!session) return { session: null, cashTakenPaise: 0, expectedPaise: 0 };

      const cashTakenPaise = await cashSessionsRepo.getCashTakenSince(db, counterId, session.openedAt);
      return { session, cashTakenPaise, expectedPaise: session.openingCashPaise + cashTakenPaise };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.cashSessionClose,
    safeHandle(ctx, IPC_CHANNELS.cashSessionClose, async (db, input: unknown) => {
      const parsed = closeCashSessionRequestSchema.parse(input);
      // A drawer short or over is the figure most worth a trail, so the close is audited with
      // what was expected, what was counted, and who counted it.
      const session = await db.transaction().execute(async (trx) => {
        const closed = await cashSessionsRepo.closeCashSession(trx, parsed);
        await auditLogRepo.appendAuditLog(trx, {
          storeId: closed.storeId,
          userId: parsed.userId,
          deviceId: ctx.deviceConfig.deviceId,
          action: "cash_session_closed",
          tableName: "cash_sessions",
          recordId: closed.id,
          oldValue: null,
          newValue: {
            expectedPaise: parsed.closingCashPaise,
            countedCashPaise: parsed.countedCashPaise,
            variancePaise: parsed.countedCashPaise - parsed.closingCashPaise,
          },
          reason: null,
        });
        return closed;
      });
      return { ok: true, session };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.printerPrintReceipt,
    // "DUPLICATE COPY" is decided from the print log inside, never sent by the renderer.
    safeHandle(ctx, IPC_CHANNELS.printerPrintReceipt, async (db, saleId: unknown, actingUserId: unknown) =>
      printSaleReceipt(db, ctx, saleId, actingUserId),
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.printerListPrinters,
    safeHandle(ctx, IPC_CHANNELS.printerListPrinters, async () => listPrinters()),
  );

  registerStaffHandlers(ctx);
  registerReceiptHandlers(ctx);
  registerBillingHandlers(ctx);
  registerProductHandlers(ctx);
  registerBatchHandlers(ctx);
  registerPurchaseOrderHandlers(ctx);
  registerInsightsHandlers(ctx);
  registerUiSettingsHandlers(ctx);
  registerProductPackHandlers(ctx);
  registerLabelHandlers(ctx);
}
