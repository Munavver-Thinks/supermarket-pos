import { describe, expect, it } from "vitest";

import { assertCreditAllowed, creditPortionPaise, CreditNotAllowedError, creditRejectionReason } from "@/core/business-logic/creditPolicy.js";

describe("creditPortionPaise", () => {
  it("sums only the credit-mode payments", () => {
    expect(
      creditPortionPaise([
        { mode: "cash", amountPaise: 20000, refNo: null },
        { mode: "credit", amountPaise: 80000, refNo: null },
      ]),
    ).toBe(80000);
  });

  it("is zero for a fully settled bill", () => {
    expect(creditPortionPaise([{ mode: "upi", amountPaise: 50000, refNo: null }])).toBe(0);
  });
});

describe("creditRejectionReason", () => {
  it("refuses credit with no customer attached", () => {
    const reason = creditRejectionReason({
      balancePaise: 0,
      creditLimitPaise: 0,
      creditAmountPaise: 10000,
      customerId: null,
    });
    expect(reason).toMatch(/needs a customer/i);
  });

  it("allows a bill with no credit portion and no customer", () => {
    expect(
      creditRejectionReason({ balancePaise: 0, creditLimitPaise: 0, creditAmountPaise: 0, customerId: null }),
    ).toBeNull();
  });

  it("treats a zero limit as no limit rather than no credit", () => {
    expect(
      creditRejectionReason({
        balancePaise: 500000,
        creditLimitPaise: 0,
        creditAmountPaise: 10000,
        customerId: "c1",
      }),
    ).toBeNull();
  });

  it("refuses a bill that would cross the limit, counting the existing balance", () => {
    const reason = creditRejectionReason({
      balancePaise: 90000,
      creditLimitPaise: 100000,
      creditAmountPaise: 20000,
      customerId: "c1",
    });
    expect(reason).toMatch(/credit limit/i);
    // The message must name the resulting balance, not just say "no".
    expect(reason).toContain("₹1,100.00");
  });

  it("allows a bill that lands exactly on the limit", () => {
    expect(
      creditRejectionReason({
        balancePaise: 90000,
        creditLimitPaise: 100000,
        creditAmountPaise: 10000,
        customerId: "c1",
      }),
    ).toBeNull();
  });

  it("throws from the asserting form", () => {
    expect(() =>
      assertCreditAllowed({ balancePaise: 0, creditLimitPaise: 0, creditAmountPaise: 1, customerId: null }),
    ).toThrow(CreditNotAllowedError);
  });
});
