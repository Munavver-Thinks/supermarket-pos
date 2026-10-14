import {
  buildLabelSheetHtml,
  canChangeStoreSettings,
  LABEL_LAYOUT_KEY,
  LABEL_PRINTER_KEY,
  labelLayoutOverflow,
  labelPageSizeMm,
  parseLabelLayout,
} from "@pos/business-logic";
import { auditLogRepo, labelsRepo, settingsRepo, type Db } from "@pos/database";
import {
  labelDefaultsRequestSchema,
  labelSettingsRequestSchema,
  printLabelsRequestSchema,
  repackHistoryRequestSchema,
} from "@pos/validation";
import { ipcMain } from "electron";

import { IPC_CHANNELS, type LabelSettings } from "../../shared/ipc.js";
import { printLabels } from "../printer.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";
import { productActor } from "./products.js";

async function readLabelSettings(db: Db): Promise<LabelSettings> {
  const printer = (await settingsRepo.getSetting(db, LABEL_PRINTER_KEY))?.trim();
  const layout = parseLabelLayout(await settingsRepo.getSetting(db, LABEL_LAYOUT_KEY));
  return { printerName: printer ? printer : null, ...layout };
}

export function registerLabelHandlers(ctx: HandlerContext): void {
  const NOT_IN_STORE = "You are not signed in to this store.";

  ipcMain.handle(
    IPC_CHANNELS.labelsGetDefaults,
    safeHandle(
      ctx,
      IPC_CHANNELS.labelsGetDefaults,
      async (db, storeId: unknown, actingUserId: unknown, productId: unknown, repackId: unknown) => {
        const parsed = labelDefaultsRequestSchema.parse({ storeId, actingUserId, productId, repackId });
        const actor = await productActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false as const, error: actor.error };
        if (parsed.storeId !== ctx.deviceConfig.storeId) return { ok: false as const, error: NOT_IN_STORE };
        try {
          return await labelsRepo.getLabelDefaults(db, parsed.storeId, parsed.productId, parsed.repackId);
        } catch (error) {
          if (error instanceof labelsRepo.LabelError) return { ok: false as const, error: error.message };
          throw error;
        }
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.labelsPrint,
    safeHandle(ctx, IPC_CHANNELS.labelsPrint, async (db, req: unknown, actingUserId: unknown) => {
      const body = req && typeof req === "object" ? (req as Record<string, unknown>) : {};
      const parsed = printLabelsRequestSchema.parse({ ...body, actingUserId });
      const actor = await productActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false as const, error: actor.error };
      if (parsed.storeId !== ctx.deviceConfig.storeId) return { ok: false as const, error: NOT_IN_STORE };
      if (parsed.mrpPaise > 0 && parsed.salePricePaise > parsed.mrpPaise) {
        return { ok: false as const, error: "The price can't be more than the MRP." };
      }

      const audit = { userId: actor.id, deviceId: ctx.deviceConfig.deviceId };
      try {
        const defaults = await labelsRepo.getLabelDefaults(db, parsed.storeId, parsed.productId, parsed.repackId);
        const { barcode, assigned } = await labelsRepo.ensureProductBarcode(db, parsed.storeId, parsed.productId, audit);

        const { printerName, ...layout } = await readLabelSettings(db);
        const html = buildLabelSheetHtml(
          {
            storeName: defaults.storeName,
            productName: defaults.productName,
            barcode,
            packedOn: parsed.packedOn,
            expiryDate: parsed.expiryDate,
            mrpPaise: parsed.mrpPaise,
            salePricePaise: parsed.salePricePaise,
          },
          parsed.copies,
          layout,
          parsed.startAt,
        );
        const page = labelPageSizeMm(layout);
        const result = await printLabels(html, {
          printerName,
          widthMm: page.widthMm,
          heightMm: page.heightMm,
        });
        if (!result.ok) return { ok: false as const, error: result.error ?? "Could not print the labels." };

        await labelsRepo.recordLabelPrint(
          db,
          {
            storeId: parsed.storeId,
            productId: parsed.productId,
            repackId: parsed.repackId,
            labelCount: parsed.copies,
            barcode,
            packedOn: parsed.packedOn,
            expiryDate: parsed.expiryDate,
            mrpPaise: parsed.mrpPaise,
            salePricePaise: parsed.salePricePaise,
            userId: actor.id,
          },
          audit,
        );
        return { ok: true as const, barcode, barcodeAssigned: assigned };
      } catch (error) {
        if (error instanceof labelsRepo.LabelError) return { ok: false as const, error: error.message };
        throw error;
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.labelsGetSettings,
    safeHandle(ctx, IPC_CHANNELS.labelsGetSettings, async (db) => readLabelSettings(db)),
  );

  ipcMain.handle(
    IPC_CHANNELS.labelsSetSettings,
    safeHandle(ctx, IPC_CHANNELS.labelsSetSettings, async (db, settings: unknown, actingUserId: unknown) => {
      const body = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
      const parsed = labelSettingsRequestSchema.parse({ ...body, actingUserId });

      // Same rule as every store setting: re-read the actor rather than trust the renderer.
      const actor = await getStoreActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false, error: actor.error };
      if (!canChangeStoreSettings(actor.role)) {
        return { ok: false, error: "Only an owner or manager can change this." };
      }

      const layout = parseLabelLayout(
        JSON.stringify({
          paper: parsed.paper,
          columns: parsed.columns,
          rows: parsed.rows,
          widthMm: parsed.widthMm,
          heightMm: parsed.heightMm,
          gapMm: parsed.gapMm,
          rowGapMm: parsed.rowGapMm,
          marginTopMm: parsed.marginTopMm,
          marginLeftMm: parsed.marginLeftMm,
        }),
      );
      const overflow = labelLayoutOverflow(layout);
      if (overflow) return { ok: false, error: overflow };
      const changes: Array<{ key: string; value: string }> = [
        { key: LABEL_PRINTER_KEY, value: parsed.printerName ?? "" },
        { key: LABEL_LAYOUT_KEY, value: JSON.stringify(layout) },
      ];

      await db.transaction().execute(async (trx) => {
        for (const { key, value } of changes) {
          const before = (await settingsRepo.getSetting(trx, key)) ?? "";
          if (before === value) continue;
          await settingsRepo.setSetting(trx, key, value);
          await auditLogRepo.appendAuditLog(trx, {
            storeId: ctx.deviceConfig.storeId,
            userId: actor.id,
            deviceId: ctx.deviceConfig.deviceId,
            action: "setting_changed",
            tableName: "app_settings",
            recordId: key,
            oldValue: before,
            newValue: value,
            reason: null,
          });
        }
      });
      return { ok: true };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.inventoryRepackHistory,
    safeHandle(
      ctx,
      IPC_CHANNELS.inventoryRepackHistory,
      async (db, storeId: unknown, actingUserId: unknown, productId: unknown) => {
        const parsed = repackHistoryRequestSchema.parse({ storeId, actingUserId, productId });
        const actor = await productActor(db, ctx, parsed.actingUserId);
        if ("error" in actor) return { ok: false as const, error: actor.error };
        if (parsed.storeId !== ctx.deviceConfig.storeId) return { ok: false as const, error: NOT_IN_STORE };
        return labelsRepo.listRepackHistory(db, parsed.storeId, parsed.productId);
      },
    ),
  );
}
