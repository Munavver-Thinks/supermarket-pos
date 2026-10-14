import type { PosApi } from "@shared/ipc.js";

/** The only place in the renderer that reads `window.api` (the preload bridge). */
export function posApi(): PosApi {
  return window.api;
}
