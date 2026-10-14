import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  serializeThemePreference,
  themeSettingKey,
  type ThemePreference,
} from "@pos/business-logic";
import { auditLogRepo, settingsRepo, usersRepo, type Db } from "@pos/database";
import { getUiThemeRequestSchema, setUiThemeRequestSchema } from "@pos/validation";

export interface ThemeScope {
  storeId: string;
  deviceId: string;
}

/**
 * A user's saved theme. An unknown, inactive or other-store user gets the defaults — never an
 * error and never somebody else's data. Kept free of electron so it can be tested in Node.
 */
export async function getUserTheme(db: Db, scope: ThemeScope, userId: unknown): Promise<ThemePreference> {
  const parsed = getUiThemeRequestSchema.parse({ userId });
  const user = await usersRepo.getById(db, parsed.userId);
  if (!user || !user.isActive || user.storeId !== scope.storeId) return { ...DEFAULT_THEME_PREFERENCE };
  return parseThemePreference(await settingsRepo.getSetting(db, themeSettingKey(user.id)));
}

/** Saves the acting user's OWN theme (the key is built from their id) and audits the change. */
export async function setUserTheme(
  db: Db,
  scope: ThemeScope,
  theme: unknown,
  actingUserId: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = setUiThemeRequestSchema.parse({ theme, actingUserId });

  const actor = await usersRepo.getById(db, parsed.actingUserId);
  if (!actor || !actor.isActive || actor.storeId !== scope.storeId) {
    return { ok: false, error: "You are not signed in to this store." };
  }

  const key = themeSettingKey(actor.id);
  await db.transaction().execute(async (trx) => {
    const before = parseThemePreference(await settingsRepo.getSetting(trx, key));
    const after = serializeThemePreference(parsed.theme);
    await settingsRepo.setSetting(trx, key, after);
    await auditLogRepo.appendAuditLog(trx, {
      storeId: scope.storeId,
      userId: actor.id,
      deviceId: scope.deviceId,
      action: "setting_changed",
      tableName: "app_settings",
      recordId: key,
      oldValue: serializeThemePreference(before),
      newValue: after,
      reason: null,
    });
  });

  return { ok: true };
}
