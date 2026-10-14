import { canChangePrices, localDateIso } from "@pos/business-logic";
import { productPacksRepo, productsAdminRepo, repackRepo } from "@pos/database";
import {
  createChildProductRequestSchema,
  listProductChildrenRequestSchema,
  relinkChildPriceRequestSchema,
  repackRequestSchema,
} from "@pos/validation";
import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";
import { productActor, productUserError } from "./products.js";

/** Refusals the person at the screen can fix themselves; anything else is a real error. */
function packUserError(error: unknown): string | null {
  if (
    error instanceof productPacksRepo.ParentIsAChildError ||
    error instanceof productsAdminRepo.ProductNotFoundError ||
    error instanceof productsAdminRepo.NotAPackChildError ||
    error instanceof repackRepo.RepackError
  ) {
    return error.message;
  }
  return productUserError(error);
}

export function registerProductPackHandlers(ctx: HandlerContext): void {
  const audit = (actor: { id: string }) => ({
    storeId: ctx.deviceConfig.storeId,
    userId: actor.id,
    deviceId: ctx.deviceConfig.deviceId,
  });

  ipcMain.handle(
    IPC_CHANNELS.productsCreateChild,
    safeHandle(ctx, IPC_CHANNELS.productsCreateChild, async (db, storeId: unknown, actingUserId: unknown, input: unknown) => {
      const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const parsed = createChildProductRequestSchema.parse({ storeId, actingUserId, ...body });
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }

      try {
        const productId = await productPacksRepo.createChildProduct(db, parsed.storeId, {
          parentProductId: parsed.parentProductId,
          name: parsed.name,
          nameTamil: parsed.nameTamil || null,
          packQty: parsed.packQty,
          barcodes: parsed.barcodes,
          aliases: parsed.aliases,
          prices: parsed.prices ?? undefined,
          reorderLevel: parsed.reorderLevel,
          audit: audit(actor),
        });
        return { ok: true, productId };
      } catch (error) {
        const message = packUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsListChildren,
    safeHandle(
      ctx,
      IPC_CHANNELS.productsListChildren,
      async (db, storeId: unknown, actingUserId: unknown, parentProductId: unknown) => {
        const parsed = listProductChildrenRequestSchema.parse({ storeId, actingUserId, parentProductId });
        const actor = await productActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return [];
        if (parsed.storeId !== ctx.deviceConfig.storeId) return [];
        return productPacksRepo.listChildren(db, parsed.storeId, parsed.parentProductId);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsRelinkChildPrice,
    safeHandle(ctx, IPC_CHANNELS.productsRelinkChildPrice, async (db, productId: unknown, actingUserId: unknown) => {
      const parsed = relinkChildPriceRequestSchema.parse({ productId, actingUserId });
      const actor = await getStoreActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (!canChangePrices(actor.role)) {
        return { ok: false, error: "Only an owner or manager can change prices." };
      }

      try {
        const product = await productsAdminRepo.relinkChildPrice(db, parsed.productId, audit(actor));
        return { ok: true, product };
      } catch (error) {
        const message = packUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.inventoryRepack,
    safeHandle(ctx, IPC_CHANNELS.inventoryRepack, async (db, req: unknown, actingUserId: unknown) => {
      const body = req && typeof req === "object" ? (req as Record<string, unknown>) : {};
      const parsed = repackRequestSchema.parse({ ...body, actingUserId });
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }

      try {
        const result = await repackRepo.repackStock(db, {
          storeId: parsed.storeId,
          parentProductId: parsed.parentProductId,
          childProductId: parsed.childProductId,
          childQty: parsed.childQty,
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
          today: localDateIso(),
          packedOn: parsed.packedOn,
          expiryDate: parsed.expiryDate,
        });
        return { ok: true, repackId: result.repackId, batchNo: result.batchNo };
      } catch (error) {
        const message = packUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );
}
