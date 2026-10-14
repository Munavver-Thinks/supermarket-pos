import type { ConfirmOptions } from "@/components/ConfirmDialog/index.js";

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export interface Pending {
  /** Fresh per question, so a queued one remounts (and refocuses) rather than reusing the last. */
  key: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}
