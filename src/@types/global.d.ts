import type { PosApi } from "@shared/ipc.js";

declare global {
  interface Window {
    api: PosApi;
  }
}

export {};
