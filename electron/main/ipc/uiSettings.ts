import { parseUiLanguage, UI_LANGUAGE_KEY } from "@pos/business-logic";
import { auditLogRepo, settingsRepo, usersRepo } from "@pos/database";
import { setUiLanguageRequestSchema } from "@pos/validation";
import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { getUserTheme, setUserTheme } from "../uiTheme.js";

import { safeHandle, type HandlerContext } from "./common.js";

/**
 * The screen language (English/Tamil) is a per-device display preference, not a store
 * control — unlike the receipt language, any active signed-in user may change it, not just
 * an owner or manager. Still audited, like every other setting.
 *
 * The theme is per user (`ui.theme.<userId>`): any active signed-in user may change their OWN
 * theme and nobody else's; the logic lives in ../uiTheme.ts. Also audited.
 */
export function registerUiSettingsHandlers(ctx: HandlerContext): void {
  ipcMain.handle(
    IPC_CHANNELS.uiGetLanguage,
    safeHandle(ctx, IPC_CHANNELS.uiGetLanguage, async (db) => {
      return parseUiLanguage(await settingsRepo.getSetting(db, UI_LANGUAGE_KEY));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.uiSetLanguage,
    safeHandle(ctx, IPC_CHANNELS.uiSetLanguage, async (db, language: unknown, actingUserId: unknown) => {
      const parsed = setUiLanguageRequestSchema.parse({ language, actingUserId });

      const actor = await usersRepo.getById(db, parsed.actingUserId);
      if (!actor || !actor.isActive || actor.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false, error: "You are not signed in to this store." };
      }

      await db.transaction().execute(async (trx) => {
        const before = parseUiLanguage(await settingsRepo.getSetting(trx, UI_LANGUAGE_KEY));
        await settingsRepo.setSetting(trx, UI_LANGUAGE_KEY, parsed.language);
        await auditLogRepo.appendAuditLog(trx, {
          storeId: ctx.deviceConfig.storeId,
          userId: actor.id,
          deviceId: ctx.deviceConfig.deviceId,
          action: "setting_changed",
          tableName: "app_settings",
          recordId: UI_LANGUAGE_KEY,
          oldValue: before,
          newValue: parsed.language,
          reason: null,
        });
      });

      return { ok: true };
    }),
  );

  const scope = () => ({ storeId: ctx.deviceConfig.storeId, deviceId: ctx.deviceConfig.deviceId });

  ipcMain.handle(
    IPC_CHANNELS.uiGetTheme,
    safeHandle(ctx, IPC_CHANNELS.uiGetTheme, async (db, userId: unknown) => getUserTheme(db, scope(), userId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.uiSetTheme,
    safeHandle(ctx, IPC_CHANNELS.uiSetTheme, async (db, theme: unknown, actingUserId: unknown) =>
      setUserTheme(db, scope(), theme, actingUserId),
    ),
  );
}
