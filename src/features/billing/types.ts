/** What the billing screen's keyboard layer needs from an open payment window. */
export interface PaymentShortcutHandle {
  canConfirm: boolean;
  confirm: () => void;
}

/** What the billing screen's keyboard layer needs from an open settle window — same shape as
 * PaymentModal's, since this modal takes over the same "payment" shortcut layer whenever a
 * pending return covers the whole new total (N ≤ R). */
export interface ExchangeSettleShortcutHandle {
  canConfirm: boolean;
  confirm: () => void;
}
