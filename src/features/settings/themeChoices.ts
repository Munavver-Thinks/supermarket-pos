import { resolveTheme, type ThemeMode, type ThemePreference } from "@pos/business-logic";

import { THEME_CHOICES } from "./constants.js";
import type { ThemeChoice } from "./types.js";

const MODE_LABEL: Record<ThemeMode, string> = { day: "Day", night: "Night", auto: "Auto" };

/** "Calm · Day", "Vivid · Auto", or "High contrast" — what a preference is called on screen. */
export function describeThemePreference(pref: ThemePreference): string {
  if (pref.highContrast) return "High contrast";
  return `${pref.set === "vivid" ? "Vivid" : "Calm"} · ${MODE_LABEL[pref.mode]}`;
}

/** The tile that matches what is on screen now (the colour set, ignoring high contrast). */
export function currentChoice(pref: ThemePreference): ThemeChoice {
  const theme = resolveTheme({ ...pref, highContrast: false }, new Date());
  return THEME_CHOICES.find((choice) => choice.theme === theme) ?? THEME_CHOICES[0]!;
}
