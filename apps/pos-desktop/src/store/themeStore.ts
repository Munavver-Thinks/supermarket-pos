import { create } from "zustand";
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, type ThemeId, type ThemePreference } from "@pos/business-logic";

import { uiService } from "@/services/uiService.js";

export interface ThemeState {
  /** The user the preference belongs to; null on the login and activation screens. */
  userId: string | null;
  preference: ThemePreference;
  /** The theme actually on screen right now (differs from the preference while `auto`). */
  resolved: ThemeId;
  /** False until the saved preference has loaded — the defaults show meanwhile. */
  loaded: boolean;
  load: (userId: string) => Promise<void>;
  /** Applies a preference on screen without saving it (the live preview in the Appearance window). */
  preview: (preference: ThemePreference) => void;
  /** Saves the signed-in user's own theme. Optimistic; a failed save puts the previous one back. */
  setPreference: (preference: ThemePreference, actingUserId: string) => Promise<{ ok: boolean; error?: string }>;
  reset: () => void;
}

const DEFAULTS: Pick<ThemeState, "userId" | "preference" | "resolved" | "loaded"> = {
  userId: null,
  preference: DEFAULT_THEME_PREFERENCE,
  resolved: "light",
  loaded: false,
};

/** Bumped by every load and save; a load result is applied only if it is still the latest. */
let requestToken = 0;

/** The signed-in user's theme. Per user, so it is loaded at sign-in and cleared at sign-out. */
export const useThemeStore = create<ThemeState>((set, get) => ({
  ...DEFAULTS,
  load: async (userId) => {
    requestToken += 1;
    const token = requestToken;
    set({ userId, preference: DEFAULT_THEME_PREFERENCE, loaded: false });
    try {
      const result = await uiService.getTheme(userId);
      // A failed call can arrive as `{ ok: false, error }`; the parser falls back field by field.
      const preference = parseThemePreference(JSON.stringify(result));
      if (get().userId === userId && token === requestToken) set({ preference, loaded: true });
    } catch {
      if (get().userId === userId && token === requestToken) set({ loaded: true });
    }
  },
  preview: (preference) => set({ preference }),
  setPreference: async (preference, actingUserId) => {
    // A save supersedes any load still in flight, so the load cannot overwrite it.
    requestToken += 1;
    const previous = get().preference;
    set({ preference });
    try {
      const result = await uiService.setTheme(preference, actingUserId);
      if (!result.ok) set({ preference: previous });
      return result;
    } catch {
      set({ preference: previous });
      return { ok: false, error: "Could not reach the local service. Please retry." };
    }
  },
  reset: () => set({ ...DEFAULTS }),
}));
