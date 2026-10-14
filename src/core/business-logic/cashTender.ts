import type { ChangeAction, PaymentInput, PaymentMode } from "@pos/types";

import { creditPortionPaise } from "./creditPolicy.js";

/**
 * Cash tendered + change due (Decision 1/2 of the feature): a customer may hand over more
 * cash than the bill needs, and the cashier chooses each time whether the overage is handed
 * back or kept on the customer's khata.
 *
 * The math (all paise, all >= 0):
 * - nonCashPaise = upi + card + credit
 * - cashDuePaise = max(0, net - nonCashPaise) — what's left for cash to cover
 * - cashAppliedPaise = min(cashTenderedPaise, cashDuePaise) — never more than its own share
 * - changePaise = cashDuePaise > 0 ? max(0, cashTenderedPaise - cashDuePaise) : 0 — cash typed
 *   when nothing is left for it to pay never gives change, it's just stray cash (below)
 * - strayCashPaise = cashDuePaise === 0 ? cashTenderedPaise : 0
 * - balancePaise = net - nonCashPaise - cashAppliedPaise - strayCashPaise
 *
 * What the server receives (Decision 2): the cash leg's amountPaise sent to the server is
 * ALWAYS cashAppliedPaise, never the raw tendered figure — tenderedPaise rides alongside it as
 * an extra field. Every payment leg still sums to exactly netPaise (or `payable` on an
 * exchange) whenever the bill balances, so every existing reader of payments.amountPaise
 * (dashboard, reports, exchange netting) stays correct with zero changes to it.
 */

export type TenderAmounts = Record<PaymentMode, number>;

export interface TenderBreakdown {
  nonCashPaise: number;
  cashDuePaise: number;
  cashTenderedPaise: number;
  cashAppliedPaise: number;
  changePaise: number;
  strayCashPaise: number;
  balancePaise: number;
}

export function computeTender(netPaise: number, amounts: TenderAmounts): TenderBreakdown {
  const nonCashPaise = amounts.upi + amounts.card + amounts.credit;
  const cashDuePaise = Math.max(0, netPaise - nonCashPaise);
  const cashTenderedPaise = amounts.cash;
  const cashAppliedPaise = Math.min(cashTenderedPaise, cashDuePaise);
  const changePaise = cashDuePaise > 0 ? Math.max(0, cashTenderedPaise - cashDuePaise) : 0;
  const strayCashPaise = cashDuePaise === 0 ? cashTenderedPaise : 0;
  const balancePaise = netPaise - nonCashPaise - cashAppliedPaise - strayCashPaise;

  return { nonCashPaise, cashDuePaise, cashTenderedPaise, cashAppliedPaise, changePaise, strayCashPaise, balancePaise };
}

/**
 * "Keep on khata" is only offered when there's a customer to charge it to, and when the bill
 * isn't already partly on credit — mixing partial-credit with khata-change is contradictory,
 * the cashier should just reduce the credit amount instead (Decision 4).
 */
export function canKeepChangeOnKhata(input: { customerId: string | null; creditPaise: number }): boolean {
  return input.customerId !== null && input.creditPaise === 0;
}

/**
 * Builds the payment legs to send to the server: cash, upi, card, credit in that order. The
 * cash leg (if any) carries the applied amount, never the tendered one — tenderedPaise and
 * changeAction only ride along when there's actually change to account for.
 */
export function buildTenderPayments(
  amounts: TenderAmounts,
  t: TenderBreakdown,
  changeAction: ChangeAction | null,
): PaymentInput[] {
  const legs: PaymentInput[] = [];

  if (t.cashAppliedPaise > 0) {
    legs.push({
      mode: "cash",
      amountPaise: t.cashAppliedPaise,
      refNo: null,
      ...(t.changePaise > 0 ? { tenderedPaise: t.cashTenderedPaise, changeAction } : {}),
    });
  }
  for (const mode of ["upi", "card", "credit"] as const) {
    if (amounts[mode] > 0) {
      legs.push({ mode, amountPaise: amounts[mode], refNo: null });
    }
  }

  return legs;
}

/**
 * Server-side validation for the cash-tender fields, checked in order so the cashier always
 * sees the most relevant message first. Returns null when the payments are fine. The client
 * (PaymentModal) is built so a cashier can never actually produce most of these — this is
 * defense-in-depth against a stale client or a direct repository caller.
 */
export function cashTenderRejection(payments: PaymentInput[], customerId: string | null): string | null {
  const withTendered = payments.filter((p) => p.tenderedPaise != null);
  const withChangeAction = payments.filter((p) => p.changeAction != null);

  if (payments.some((p) => p.mode !== "cash" && (p.tenderedPaise != null || p.changeAction != null))) {
    return "Only a cash payment can have change.";
  }

  if (withTendered.length > 1) {
    return "Only one cash payment can have change.";
  }

  const mismatched = payments.some(
    (p) => (p.changeAction != null && p.tenderedPaise == null) || (p.tenderedPaise != null && p.changeAction == null),
  );
  if (mismatched) {
    return "Choose what to do with the change, then confirm again.";
  }

  const overpaidLeg = withTendered[0];
  if (overpaidLeg && overpaidLeg.tenderedPaise! <= overpaidLeg.amountPaise) {
    return "Cash handed over must be more than the cash due when change is given.";
  }

  const khataLeg = withChangeAction.find((p) => p.changeAction === "khata");
  if (khataLeg) {
    if (!customerId) {
      return "Keeping change on khata needs a customer on the bill.";
    }
    if (creditPortionPaise(payments) > 0) {
      return "Change can't go to khata on a bill that is partly on credit — reduce the credit amount instead.";
    }
  }

  return null;
}
