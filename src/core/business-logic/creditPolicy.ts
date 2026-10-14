import type { PaymentInput } from "@pos/types";

import { formatIndianCurrency } from "./money.js";

/** Total of the credit-mode payments on a bill — the amount going onto the khata. */
export function creditPortionPaise(payments: PaymentInput[]): number {
  return payments.filter((p) => p.mode === "credit").reduce((sum, p) => sum + p.amountPaise, 0);
}

export class CreditNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditNotAllowedError";
  }
}

export interface CreditCheckInput {
  /** What the customer already owes, in paise. */
  balancePaise: number;
  /** 0 means no limit has been set, so nothing binds. */
  creditLimitPaise: number;
  /** The credit portion of the bill being rung up. */
  creditAmountPaise: number;
  /** Null when no customer is attached to the bill. */
  customerId: string | null;
}

/**
 * Decides whether a bill's credit portion may be taken. Credit without a named customer is
 * the case that matters most: goods leave the shop and nothing records who owes for them,
 * which is exactly the hole the khata exists to close.
 *
 * Returns an error message rather than throwing, so the billing screen can grey out the
 * credit option before the cashier commits rather than only rejecting at save time.
 */
export function creditRejectionReason(input: CreditCheckInput): string | null {
  if (input.creditAmountPaise <= 0) return null;

  if (!input.customerId) {
    return "Credit needs a customer on the bill. Attach one, or take payment another way.";
  }

  if (input.creditLimitPaise > 0) {
    const after = input.balancePaise + input.creditAmountPaise;
    if (after > input.creditLimitPaise) {
      return (
        `This would take the customer to ${formatIndianCurrency(after)}, over their ` +
        `${formatIndianCurrency(input.creditLimitPaise)} credit limit.`
      );
    }
  }

  return null;
}

/** Throwing form, for the main process to enforce what the UI already guards. */
export function assertCreditAllowed(input: CreditCheckInput): void {
  const reason = creditRejectionReason(input);
  if (reason) throw new CreditNotAllowedError(reason);
}
