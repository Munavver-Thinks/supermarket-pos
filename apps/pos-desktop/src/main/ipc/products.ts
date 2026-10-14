import { canChangePrices, canManageProducts } from "@pos/business-logic";
import { productsAdminRepo, suppliersRepo, type Db } from "@pos/database";
import type { User } from "@pos/types";
import {
  changeProductPricesRequestSchema,
  listProductsAdminRequestSchema,
  setProductActiveRequestSchema,
  updateProductRequestSchema,
} from "@pos/validation";
import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";

/**
 * Re-reads the acting user and checks they do stock work. Product details decide what the
 * counter scans and sells, so the renderer hiding a button is not the control — this is.
 */
export async function productActor(db: Db, ctx: HandlerContext, actingUserId: string): Promise<User | { error: string }> {
  const actor = await getStoreActor(db, ctx, actingUserId);
  if ("error" in actor) return actor;
  if (!canManageProducts(actor.role)) {
    return { error: "Only an owner, manager or inventory staff can change products." };
  }
  return actor;
}

/** A supplier id from the renderer must be one of this store's before a product points at it. */
export async function isStoreSupplierId(db: Db, ctx: HandlerContext, supplierId: string | null): Promise<boolean> {
  if (!supplierId) return true;
  const supplier = await suppliersRepo.getSupplier(db, supplierId);
  return supplier !== undefined && supplier.storeId === ctx.deviceConfig.storeId;
}

/** Refusals the person at the screen can fix themselves; anything else is a real error. */
export function productUserError(error: unknown): string | null {
  if (
    error instanceof productsAdminRepo.DuplicateBarcodeError ||
    error instanceof productsAdminRepo.DuplicateShortCodeError ||
    error instanceof productsAdminRepo.ProductNotFoundError
  ) {
    return error.message;
  }
  return null;
}

export function registerProductHandlers(ctx: HandlerContext): void {
  const audit = (actor: User) => ({
    storeId: ctx.deviceConfig.storeId,
    userId: actor.id,
    deviceId: ctx.deviceConfig.deviceId,
  });

  ipcMain.handle(
    IPC_CHANNELS.productsListAdmin,
    safeHandle(ctx, IPC_CHANNELS.productsListAdmin, async (db, req: unknown) => {
      const parsed = listProductsAdminRequestSchema.parse(req);
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false as const, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "You are not signed in to this store." };
      }
      return productsAdminRepo.listProductsForAdmin(db, parsed.storeId, parsed);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsGet,
    safeHandle(ctx, IPC_CHANNELS.productsGet, async (db, productId: unknown, actingUserId: unknown) => {
      const id = z.string().uuid().parse(productId);
      const actor = await productActor(db, ctx, z.string().uuid().parse(actingUserId));
      if ("error" in actor) return { ok: false as const, error: actor.error };
      const product = await productsAdminRepo.getProductForEdit(db, id);
      if (!product || product.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "That product could not be found." };
      }
      return product;
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsUpdate,
    safeHandle(ctx, IPC_CHANNELS.productsUpdate, async (db, req: unknown) => {
      const parsed = updateProductRequestSchema.parse(req);
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (!(await isStoreSupplierId(db, ctx, parsed.details.supplierId))) {
        return { ok: false, error: "That supplier could not be found." };
      }

      try {
        // The repository checks the product is this store's, inside its own transaction.
        const product = await productsAdminRepo.updateProduct(
          db,
          parsed.productId,
          {
            ...parsed.details,
            nameTamil: parsed.details.nameTamil || null,
            shortCode: parsed.details.shortCode || null,
            hsnCode: parsed.details.hsnCode || null,
          },
          audit(actor),
        );
        return { ok: true, product };
      } catch (error) {
        const message = productUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsChangePrices,
    safeHandle(ctx, IPC_CHANNELS.productsChangePrices, async (db, req: unknown) => {
      const parsed = changeProductPricesRequestSchema.parse(req);
      const actor = await getStoreActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (!canChangePrices(actor.role)) {
        return { ok: false, error: "Only an owner or manager can change prices." };
      }

      try {
        const changed = await productsAdminRepo.changeProductPrices(db, parsed.productId, parsed.prices, audit(actor));
        return { ok: true, changed };
      } catch (error) {
        const message = productUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.productsSetActive,
    safeHandle(ctx, IPC_CHANNELS.productsSetActive, async (db, req: unknown) => {
      const parsed = setProductActiveRequestSchema.parse(req);
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };

      try {
        await productsAdminRepo.setProductActive(db, parsed.productId, parsed.isActive, audit(actor));
        return { ok: true };
      } catch (error) {
        const message = productUserError(error);
        if (message) return { ok: false, error: message };
        throw error;
      }
    }),
  );
}
