import { canManagePurchaseOrders, canPlacePurchaseOrder, computePurchaseTotals } from "@pos/business-logic";
import { purchaseOrdersRepo, purchasesRepo, suppliersRepo, type Db } from "@pos/database";
import type { User } from "@pos/types";
import {
  createPurchaseOrderRequestSchema,
  listPurchaseOrdersRequestSchema,
  purchaseOrderActionRequestSchema,
  receivePurchaseOrderRequestSchema,
  updatePurchaseOrderRequestSchema,
} from "@pos/validation";
import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";

/** Owner, manager or inventory staff — the roles that order and receive stock. */
export async function purchaseOrderActor(
  db: Db,
  ctx: HandlerContext,
  actingUserId: string,
): Promise<User | { error: string }> {
  const actor = await getStoreActor(db, ctx, actingUserId);
  if ("error" in actor) return actor;
  if (!canManagePurchaseOrders(actor.role)) {
    return { error: "Only an owner, manager or inventory staff can handle purchases." };
  }
  return actor;
}

/** Refusals the user can act on, shown as-is rather than logged as crashes. */
function purchaseOrderUserError(error: unknown): string | null {
  if (
    error instanceof purchaseOrdersRepo.PurchaseOrderError ||
    error instanceof purchasesRepo.DuplicatePurchaseInvoiceError
  ) {
    return error.message;
  }
  return null;
}

/** Orders are valued at the ordered cost with the same engine a goods receipt uses. */
function orderTotal(
  lines: Array<{ productId: string; qtyOrdered: number; costPricePaise: number; taxRatePercent: number; isTaxInclusive: boolean }>,
): number {
  return computePurchaseTotals(lines.map((l) => ({ ...l, qty: l.qtyOrdered }))).totals.totalPaise;
}

export function registerPurchaseOrderHandlers(ctx: HandlerContext): void {
  const actorFor = (user: User) => ({
    storeId: ctx.deviceConfig.storeId,
    userId: user.id,
    deviceId: ctx.deviceConfig.deviceId,
  });

  /** Runs a repository call, turning the refusals a user can fix into `{ ok: false }`. */
  async function attempt<T>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
    try {
      return await run();
    } catch (error) {
      const message = purchaseOrderUserError(error);
      if (message) return { ok: false, error: message };
      throw error;
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersList,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersList, async (db, req: unknown) => {
      const parsed = listPurchaseOrdersRequestSchema.parse(req);
      const actor = await purchaseOrderActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false as const, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "You are not signed in to this store." };
      }
      return purchaseOrdersRepo.listPurchaseOrders(db, parsed.storeId, {
        status: parsed.status ?? undefined,
        limit: parsed.limit,
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersGet,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersGet, async (db, poId: unknown, actingUserId: unknown) => {
      const id = z.string().uuid().parse(poId);
      const actor = await purchaseOrderActor(db, ctx, z.string().uuid().parse(actingUserId));
      if ("error" in actor) return { ok: false as const, error: actor.error };
      const detail = await purchaseOrdersRepo.getPurchaseOrder(db, id);
      if (!detail || detail.order.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "That purchase order could not be found." };
      }
      return detail;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersCreate,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersCreate, async (db, input: unknown) => {
      const parsed = createPurchaseOrderRequestSchema.parse(input);
      const actor = await purchaseOrderActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }
      const supplier = await suppliersRepo.getSupplier(db, parsed.supplierId);
      if (!supplier || supplier.storeId !== ctx.deviceConfig.storeId || !supplier.isActive) {
        return { ok: false, error: "That supplier could not be found." };
      }

      // The repository checks every product belongs to this store.
      return attempt(async () => {
        const order = await purchaseOrdersRepo.createPurchaseOrder(
          db,
          {
            supplierId: parsed.supplierId,
            expectedDate: parsed.expectedDate,
            notes: parsed.notes,
            lines: parsed.lines,
            totalPaise: orderTotal(parsed.lines),
          },
          actorFor(actor),
        );
        return { ok: true, order };
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersUpdate,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersUpdate, async (db, input: unknown) => {
      const parsed = updatePurchaseOrderRequestSchema.parse(input);
      const actor = await purchaseOrderActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };

      return attempt(async () => {
        const order = await purchaseOrdersRepo.updatePurchaseOrder(
          db,
          parsed.poId,
          {
            expectedDate: parsed.expectedDate,
            notes: parsed.notes,
            lines: parsed.lines,
            totalPaise: orderTotal(parsed.lines),
          },
          actorFor(actor),
        );
        return { ok: true, order };
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersPlace,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersPlace, async (db, poId: unknown, actingUserId: unknown) => {
      const parsed = purchaseOrderActionRequestSchema.parse({ poId, actingUserId });
      const actor = await getStoreActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (!canPlacePurchaseOrder(actor.role)) {
        return { ok: false, error: "Only an owner or manager can place a purchase order." };
      }
      return attempt(async () => {
        const order = await purchaseOrdersRepo.placePurchaseOrder(db, parsed.poId, actorFor(actor));
        return { ok: true, order };
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersCancel,
    safeHandle(
      ctx,
      IPC_CHANNELS.purchaseOrdersCancel,
      async (db, poId: unknown, actingUserId: unknown, reason: unknown) => {
        const parsed = purchaseOrderActionRequestSchema.parse({ poId, actingUserId, reason });
        const actor = await getStoreActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (!canPlacePurchaseOrder(actor.role)) {
          return { ok: false, error: "Only an owner or manager can cancel a purchase order." };
        }
        return attempt(async () => {
          const order = await purchaseOrdersRepo.cancelPurchaseOrder(
            db,
            parsed.poId,
            parsed.reason ?? null,
            actorFor(actor),
          );
          return { ok: true, order };
        });
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.purchaseOrdersReceive,
    safeHandle(ctx, IPC_CHANNELS.purchaseOrdersReceive, async (db, input: unknown) => {
      const parsed = receivePurchaseOrderRequestSchema.parse(input);
      const actor = await purchaseOrderActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };

      const detail = await purchaseOrdersRepo.getPurchaseOrder(db, parsed.poId);
      if (!detail || detail.order.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "That purchase order could not be found." };
      }

      // Money is worked out here from the order's own tax details and the cost as invoiced;
      // the screen only says which item, how many, and at what price.
      const itemsById = new Map(detail.items.map((i) => [i.id, i]));
      const engineLines = [];
      for (const line of parsed.lines) {
        const item = itemsById.get(line.poItemId);
        if (!item) return { ok: false, error: "An item received is not on this purchase order." };
        engineLines.push({
          productId: item.productId,
          qty: line.qty,
          costPricePaise: line.costPricePaise,
          taxRatePercent: item.taxRatePercent,
          isTaxInclusive: item.isTaxInclusive,
          batchNo: line.batchNo?.trim() || null,
          expiryDate: line.expiryDate || null,
          mrpPaise: line.mrpPaise ?? null,
        });
      }
      const { lines, totals } = computePurchaseTotals(engineLines);

      return attempt(async () => {
        const result = await purchaseOrdersRepo.receivePurchaseOrder(
          db,
          {
            poId: parsed.poId,
            clientTxnId: parsed.clientTxnId,
            invoiceNo: parsed.invoiceNo,
            invoiceDate: parsed.invoiceDate,
            notes: parsed.notes,
            updateCostPrice: parsed.updateCostPrice,
            lines: lines.map((line, i) => ({ poItemId: parsed.lines[i]!.poItemId, line })),
            totals,
          },
          actorFor(actor),
        );
        return {
          ok: true,
          order: result.order,
          purchaseId: result.purchase.id,
          alreadyExisted: result.alreadyExisted,
        };
      });
    }),
  );
}
