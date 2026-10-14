import { create } from "zustand";
import type { UiLanguage } from "@pos/business-logic";

import { uiService } from "@/services/uiService.js";

export interface UiLanguageState {
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
