/**
 * Per-user appearance preference. Stored as JSON under `ui.theme.<userId>` (one row per user,
 * unlike the per-device screen language) and resolved to one of the five `data-theme` ids
 * defined in the renderer's styles.css. `auto` follows the local clock only.
 */

export type ThemeSet = "calm" | "vivid";
export type ThemeMode = "day" | "night" | "auto";
export type ThemeId = "light" | "dark" | "contrast" | "vivid" | "vivid-night";

export interface ThemePreference {
  set: ThemeSet;
  mode: ThemeMode;
  highContrast: boolean;
}

export const THEME_KEY_PREFIX = "ui.theme.";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = { set: "calm", mode: "day", highContrast: false };

export function themeSettingKey(userId: string): string {
  return `${THEME_KEY_PREFIX}${userId}`;
}

/** Never throws: bad JSON or any invalid field falls back (field by field) to the defaults. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  const fallback = { ...DEFAULT_THEME_PREFERENCE };
  if (typeof raw !== "string" || raw === "") return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  return {
    set: record.set === "calm" || record.set === "vivid" ? record.set : fallback.set,
    mode: record.mode === "day" || record.mode === "night" || record.mode === "auto" ? record.mode : fallback.mode,
    highContrast: typeof record.highContrast === "boolean" ? record.highContrast : fallback.highContrast,
  };
}

export function serializeThemePreference(pref: ThemePreference): string {
  return JSON.stringify({ set: pref.set, mode: pref.mode, highContrast: pref.highContrast });
}

/** Night is 19:00 up to, but not including, 07:00 local time. */
export function isNightHour(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 19 || hour < 7;
}

export function resolveTheme(pref: ThemePreference, now: Date): ThemeId {
  if (pref.highContrast) return "contrast";
  const night = pref.mode === "night" || (pref.mode === "auto" && isNightHour(now));
  if (pref.set === "vivid") return night ? "vivid-night" : "vivid";
  return night ? "dark" : "light";
}
