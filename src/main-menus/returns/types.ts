import type { ReturnableLine } from "@pos/types";

import type { PAYOUT_MODES } from "./constants.js";

export type PayoutMode = (typeof PAYOUT_MODES)[number];

export interface ReturnLineSelection {
  line: ReturnableLine;
  qty: number;
}

export interface ReturnPreview {
  selected: ReturnLineSelection[];
  refundPaise: number;
  previewError: string | null;
}
