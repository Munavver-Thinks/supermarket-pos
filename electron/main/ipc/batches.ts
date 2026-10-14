import {
  BLOCK_EXPIRED_SALE_KEY,
  canChangeStoreSettings,
  localDateIso,
  parseBlockExpiredSale,
} from "@pos/business-logic";
import { auditLogRepo, productsAdminRepo, settingsRepo, stockBatchesRepo } from "@pos/database";
import { setBlockExpiredSaleRequestSchema, writeOffBatchRequestSchema } from "@pos/validation";
import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { resolveApproval } from "../approval.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";

export function registerBatchHandlers(ctx: HandlerContext): void {
  // Expiry details aren't sensitive — the counter benefits from seeing them too.
  ipcMain.handle(
    IPC_CHANNELS.batchesListExpiring,
    safeHandle(ctx, IPC_CHANNELS.batchesListExpiring, async (db, storeId: unknown, withinDays: unknown) => {
      const store = z.string().uuid().parse(storeId);
      if (store !== ctx.deviceConfig.storeId) return [];
      const days = z.number().int().min(0).max(365).parse(withinDays);
      return stockBatchesRepo.listExpiring(db, store, localDateIso(), days);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.batchesListForProduct,
    safeHandle(ctx, IPC_CHANNELS.batchesListForProduct, async (db, productId: unknown) => {
      const id = z.string().uuid().parse(productId);
      const product = await productsAdminRepo.getProductForEdit(db, id);
      if (!product || product.storeId !== ctx.deviceConfig.storeId) return [];
      return stockBatchesRepo.listForProduct(db, ctx.deviceConfig.storeId, id);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.batchesWriteOff,
    safeHandle(ctx, IPC_CHANNELS.batchesWriteOff, async (db, req: unknown) => {
      const parsed = writeOffBatchRequestSchema.parse(req);

      // Checked before asking for approval, so a repeated click on a batch that is already
      // empty is refused outright instead of prompting a manager for nothing.
      const batch = await stockBatchesRepo.getBatch(db, parsed.batchId);
      if (!batch || batch.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "That batch could not be found." };
      }
      if (batch.qtyRemaining <= 0) {
        return { ok: false, error: "This batch has already been written off." };
      }

      // A write-off is a stock correction, so it follows the same approval rule.
      const approval = await resolveApproval(db, {
        storeId: ctx.deviceConfig.storeId,
        actingUserId: parsed.actingUserId,
        action: "stock_adjustment",
        approver: parsed.approver ?? null,
        deviceId: ctx.deviceConfig.deviceId,
      });
      if (!approval.ok) {
        return { ok: false, error: approval.error, approvalRequired: approval.approvalRequired };
      }

      try {
        const result = await stockBatchesRepo.writeOffBatch(db, {
          batchId: parsed.batchId,
          storeId: ctx.deviceConfig.storeId,
          // resolveApproval has re-read this user from the database and checked their role.
          userId: parsed.actingUserId,
          approvedByUserId: approval.approvedByUserId,
          deviceId: ctx.deviceConfig.deviceId,
          note: parsed.note,
        });
        return { ok: true, qty: result.qty };
      } catch (error) {
        if (error instanceof stockBatchesRepo.BatchWriteOffError) return { ok: false, error: error.message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsGetBlockExpiredSale,
    safeHandle(ctx, IPC_CHANNELS.storeSettingsGetBlockExpiredSale, async (db) => {
      return parseBlockExpiredSale(await settingsRepo.getSetting(db, BLOCK_EXPIRED_SALE_KEY));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.storeSettingsSetBlockExpiredSale,
    safeHandle(
      ctx,
      IPC_CHANNELS.storeSettingsSetBlockExpiredSale,
      async (db, enabled: unknown, actingUserId: unknown) => {
        const parsed = setBlockExpiredSaleRequestSchema.parse({ enabled, actingUserId });

        // Same rule as the negative-stock policy: the counter doesn't switch off its own checks.
        const actor = await getStoreActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false, error: actor.error };
        if (!canChangeStoreSettings(actor.role)) {
          return { ok: false, error: "Only an owner or manager can change this." };
        }

        const value = parsed.enabled ? "true" : "false";
        await db.transaction().execute(async (trx) => {
          const before = parseBlockExpiredSale(await settingsRepo.getSetting(trx, BLOCK_EXPIRED_SALE_KEY));
          await settingsRepo.setSetting(trx, BLOCK_EXPIRED_SALE_KEY, value);
          await auditLogRepo.appendAuditLog(trx, {
            storeId: ctx.deviceConfig.storeId,
            userId: actor.id,
            deviceId: ctx.deviceConfig.deviceId,
            action: "setting_changed",
            tableName: "app_settings",
            recordId: BLOCK_EXPIRED_SALE_KEY,
            oldValue: before ? "true" : "false",
            newValue: value,
            reason: null,
          });
        });
        return { ok: true };
      },
    ),
  );
}
