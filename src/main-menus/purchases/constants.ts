import type { PurchaseOrderStatus } from "@pos/types";

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
  closed: "Closed",
};

/** Pill colour per status: draft and closed are neutral, sent is blue, part-received amber. */
export const PO_STATUS_PILL: Record<PurchaseOrderStatus, "ok" | "warn" | "bad" | "info" | "mute"> = {
  draft: "mute",
  ordered: "info",
  partially_received: "warn",
  received: "ok",
  cancelled: "bad",
  closed: "mute",
};
