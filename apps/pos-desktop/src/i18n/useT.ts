import { useEffect } from "react";
import { create } from "zustand";
import { translate, type UiLanguage, type UiStringKey } from "@pos/business-logic";

import { uiService } from "@/services/uiService.js";

interface UiLanguageState {
  language: UiLanguage;
  /** False until the stored preference has loaded — screens render in English meanwhile. */
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (language: UiLanguage, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The screen language, read once at sign-in and changed from the rail footer or Settings.
 * A failed save leaves the toggle where the user left it but doesn't persist — the caller
 * (LanguageCard) is expected to show `error` and let them retry, same as any other setting.
 */
export const useUiLanguageStore = create<UiLanguageState>((set, get) => ({
  language: "en",
  loaded: false,
  load: async () => {
    try {
      const language = await uiService.getLanguage();
      set({ language, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setLanguage: async (language, actingUserId) => {
    const previous = get().language;
    set({ language }); // optimistic — a signed-in user changing their own display preference
    try {
      const result = await uiService.setLanguage(language, actingUserId);
      if (!result.ok) set({ language: previous });
      return result;
    } catch {
      set({ language: previous });
      return { ok: false, error: "Could not reach the local service. Please retry." };
    }
  },
}));

/** Loads the saved language once and keeps `<html lang>` in sync — screen readers and the
 * `[lang="ta"]` font-stack rule in styles.css both depend on it being correct. Call once,
 * from the app shell. */
export function useLoadUiLanguage(): void {
  const load = useUiLanguageStore((s) => s.load);
  const language = useUiLanguageStore((s) => s.language);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}

/** `t(key)` bound to the current language, with the same `{name}` placeholder support as
 * `translate` itself. */
export function useT(): (key: UiStringKey, params?: Record<string, string | number>) => string {
  const language = useUiLanguageStore((s) => s.language);
  return (key, params) => translate(key, language, params);
}
