import type { PosApi } from "@shared/ipc.js";

import { posApi } from "./ipcClient.js";

/** Thin pass-through to the `errors` IPC namespace: arguments and results are forwarded untouched. */
export const errorsService = {
  onMainError: (...args: Parameters<PosApi["errors"]["onMainError"]>) => posApi().errors.onMainError(...args),
  report: (...args: Parameters<PosApi["errors"]["report"]>) => posApi().errors.report(...args),
  takeLastCrash: (...args: Parameters<PosApi["errors"]["takeLastCrash"]>) => posApi().errors.takeLastCrash(...args),
};
