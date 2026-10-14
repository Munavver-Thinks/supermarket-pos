import { create } from "zustand";
import { alertsSignature } from "@pos/business-logic";
import type { StockAlert } from "@pos/types";

import { alertsService } from "@/services/alertsService.js";

const SEEN_KEY = "pos.alerts.lastSeenSignature";

function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

interface AlertsState {
  alerts: StockAlert[];
  /** False until the first list arrives — the badge and banner show nothing before that. */
  loaded: boolean;
  /** Signature of the alert set the user last dismissed or viewed. */
  lastSeenSignature: string;
  refresh: (storeId: string) => Promise<void>;
  markSeen: () => void;
}

/**
 * Low-stock and expiry alerts for the whole shell. Refreshed after sign-in, every few
 * minutes, when the stock screens open, and after anything that changes stock. A failed
 * refresh keeps the last list rather than showing an error — alerts are a convenience and
 * must never get in the way of billing.
 */
export const useAlertsStore = create<AlertsState>((set, get) => ({
  alerts: [],
  loaded: false,
  lastSeenSignature: readSeen(),
  refresh: async (storeId) => {
    let next: StockAlert[];
    try {
      next = await alertsService.list(storeId);
      if (!Array.isArray(next)) return;
    } catch {
      return;
    }

    const { alerts: previous, loaded } = get();
    set({ alerts: next, loaded: true });

    // A desktop notification only for stock that newly ran low since the last look —
    // not for the whole list on first load. Best effort: some systems block notifications.
    if (!loaded) return;
    const known = new Set(previous.map((a) => a.key));
    const fresh = next.filter((a) => (a.kind === "low_stock" || a.kind === "out_of_stock") && !known.has(a.key));
    if (fresh.length === 0) return;
    try {
      const body = fresh.map((a) => `${a.name}: ${a.detail}`).join("\n");
      new Notification(fresh.length === 1 ? "Low stock" : `Low stock — ${fresh.length} items`, { body });
    } catch {
      // Notifications unavailable; the banner still shows.
    }
  },
  markSeen: () => {
    const signature = alertsSignature(get().alerts);
    try {
      window.localStorage.setItem(SEEN_KEY, signature);
    } catch {
      // Private storage unavailable; the dismissal lasts for this session only.
    }
    set({ lastSeenSignature: signature });
  },
}));
