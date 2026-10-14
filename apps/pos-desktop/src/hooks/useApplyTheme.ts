import { useEffect } from "react";
import { resolveTheme, type ThemeId } from "@pos/business-logic";

import { useThemeStore } from "@/store/themeStore.js";

const AUTO_RECHECK_MS = 60_000;

function paint(theme: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "dark" || theme === "vivid-night" ? "dark" : "light";
}

/**
 * Loads the signed-in user's theme and keeps `<html data-theme>` in sync. With no user (login,
 * activation, signed out) the screen is always `light`. While the mode is `auto` the clock is
 * re-checked every minute. Call once, from the app shell, before any early return.
 */
export function useApplyTheme(userId: string | null): void {
  const load = useThemeStore((s) => s.load);
  const reset = useThemeStore((s) => s.reset);
  const preference = useThemeStore((s) => s.preference);

  useEffect(() => {
    if (userId === null) reset();
    else void load(userId);
  }, [userId, load, reset]);

  useEffect(() => {
    const apply = (): void => {
      const theme = userId === null ? "light" : resolveTheme(preference, new Date());
      paint(theme);
      if (useThemeStore.getState().resolved !== theme) useThemeStore.setState({ resolved: theme });
    };
    apply();
    if (userId === null || preference.mode !== "auto") return undefined;
    const timer = setInterval(apply, AUTO_RECHECK_MS);
    return () => clearInterval(timer);
  }, [userId, preference]);
}
