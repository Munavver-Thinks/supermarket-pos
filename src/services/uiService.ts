import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `ui` IPC namespace: arguments and results are forwarded untouched. */
export const uiService = {
  getLanguage: (...args: Parameters<PosApi["ui"]["getLanguage"]>) => posApi().ui.getLanguage(...args),
  getTheme: (...args: Parameters<PosApi["ui"]["getTheme"]>) => posApi().ui.getTheme(...args),
  setLanguage: (...args: Parameters<PosApi["ui"]["setLanguage"]>) => posApi().ui.setLanguage(...args),
  setTheme: (...args: Parameters<PosApi["ui"]["setTheme"]>) => posApi().ui.setTheme(...args),
};
