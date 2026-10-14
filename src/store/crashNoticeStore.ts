import { create } from "zustand";

interface CrashNoticeState {
  /** Shown as a dismissible banner in the app shell; null when there is nothing to report. */
  notice: string | null;
  setNotice: (notice: string | null) => void;
}

export const useCrashNoticeStore = create<CrashNoticeState>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
}));
