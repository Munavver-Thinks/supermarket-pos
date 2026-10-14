import type { RefundMode } from "@pos/types";

/** The four ways a standalone refund can be paid out. "exchange" is never offered here — it's
 * set only internally, once the return's value is set off against a new bill. */
export const PAYOUT_MODES = ["cash", "upi", "card", "credit"] as const;

export const REFUND_LABEL: Record<RefundMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit: "To khata",
  exchange: "Set against new bill",
};
