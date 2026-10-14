import { describe, expect, it } from "vitest";

import { buildTenderPayments, canKeepChangeOnKhata, cashTenderRejection, computeTender, type TenderAmounts } from "@/core/business-logic/cashTender.js";

function amounts(partial: Partial<TenderAmounts>): TenderAmounts {
  return { cash: 0, upi: 0, card: 0, credit: 0, ...partial };
}

describe("computeTender", () => {
  it("exact cash: no change, balances to zero", () => {
    const t = computeTender(72000, amounts({ cash: 72000 }));
    expect(t).toMatchObject({
      nonCashPaise: 0,
      cashDuePaise: 72000,
      cashTenderedPaise: 72000,
      cashAppliedPaise: 72000,
      changePaise: 0,
      strayCashPaise: 0,
      balancePaise: 0,
    });
  });

  it("cash tendered above the bill: change is due, applied is capped at the due share", () => {
    const t = computeTender(72000, amounts({ cash: 75000 }));
    expect(t).toMatchObject({
      cashDuePaise: 72000,
      cashAppliedPaise: 72000,
      changePaise: 3000,
      strayCashPaise: 0,
      balancePaise: 0,
    });
  });

  it("UPI + cash split with change", () => {
    const t = computeTender(72000, amounts({ upi: 20000, cash: 60000 }));
    expect(t).toMatchObject({
      nonCashPaise: 20000,
      cashDuePaise: 52000,
      cashAppliedPaise: 52000,
      changePaise: 8000,
      balancePaise: 0,
    });
  });

  it("cash shortfall: a positive balance remains, no change", () => {
    const t = computeTender(72000, amounts({ cash: 70000 }));
    expect(t).toMatchObject({ cashAppliedPaise: 70000, changePaise: 0, balancePaise: 2000 });
  });

  it("non-cash alone exceeds the bill: negative balance, never change", () => {
    const t = computeTender(72000, amounts({ upi: 80000 }));
    expect(t).toMatchObject({
      nonCashPaise: 80000,
      cashDuePaise: 0,
      cashAppliedPaise: 0,
      changePaise: 0,
      strayCashPaise: 0,
      balancePaise: -8000,
    });
  });

  it("non-cash covers the bill exactly, and stray cash on top is never change", () => {
    const t = computeTender(72000, amounts({ upi: 72000, cash: 5000 }));
    expect(t).toMatchObject({
      cashDuePaise: 0,
      cashAppliedPaise: 0,
      changePaise: 0,
      strayCashPaise: 5000,
      balancePaise: -5000,
    });
  });
});

describe("canKeepChangeOnKhata", () => {
  it("allows it only with a customer and no credit portion", () => {
    expect(canKeepChangeOnKhata({ customerId: "c1", creditPaise: 0 })).toBe(true);
    expect(canKeepChangeOnKhata({ customerId: null, creditPaise: 0 })).toBe(false);
    expect(canKeepChangeOnKhata({ customerId: "c1", creditPaise: 100 })).toBe(false);
  });
});

describe("buildTenderPayments", () => {
  it("omits tenderedPaise/changeAction when there's no change", () => {
    const t = computeTender(72000, amounts({ cash: 72000 }));
    const payments = buildTenderPayments(amounts({ cash: 72000 }), t, null);
    expect(payments).toEqual([{ mode: "cash", amountPaise: 72000, refNo: null }]);
  });

  it("carries tenderedPaise and the chosen changeAction only on the cash leg", () => {
    const amt = amounts({ cash: 75000 });
    const t = computeTender(72000, amt);
    const payments = buildTenderPayments(amt, t, "handback");
    expect(payments).toEqual([
      { mode: "cash", amountPaise: 72000, refNo: null, tenderedPaise: 75000, changeAction: "handback" },
    ]);
  });

  it("every combination with balance 0 sums (by amountPaise) to net", () => {
    const cases: Array<[number, TenderAmounts]> = [
      [72000, amounts({ cash: 72000 })],
      [72000, amounts({ cash: 75000 })],
      [72000, amounts({ upi: 20000, cash: 60000 })],
      [72000, amounts({ upi: 72000 })],
      [72000, amounts({ upi: 36000, card: 36000 })],
      [72000, amounts({ credit: 72000 })],
    ];
    for (const [net, amt] of cases) {
      const t = computeTender(net, amt);
      if (t.balancePaise !== 0) continue;
      const payments = buildTenderPayments(amt, t, "handback");
      const sum = payments.reduce((s, p) => s + p.amountPaise, 0);
      expect(sum).toBe(net);
    }
  });
});

describe("cashTenderRejection", () => {
  it("rejects a non-cash leg carrying tenderedPaise", () => {
    const msg = cashTenderRejection(
      [{ mode: "upi", amountPaise: 1000, refNo: null, tenderedPaise: 2000 }],
      null,
    );
    expect(msg).toBe("Only a cash payment can have change.");
  });

  it("rejects a non-cash leg carrying changeAction", () => {
    const msg = cashTenderRejection(
      [{ mode: "card", amountPaise: 1000, refNo: null, changeAction: "handback" }],
      null,
    );
    expect(msg).toBe("Only a cash payment can have change.");
  });

  it("rejects more than one leg with tenderedPaise", () => {
    const msg = cashTenderRejection(
      [
        { mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 2000, changeAction: "handback" },
        { mode: "cash", amountPaise: 500, refNo: null, tenderedPaise: 600, changeAction: "handback" },
      ],
      null,
    );
    expect(msg).toBe("Only one cash payment can have change.");
  });

  it("rejects changeAction without tenderedPaise", () => {
    const msg = cashTenderRejection([{ mode: "cash", amountPaise: 1000, refNo: null, changeAction: "handback" }], null);
    expect(msg).toBe("Choose what to do with the change, then confirm again.");
  });

  it("rejects tenderedPaise without changeAction", () => {
    const msg = cashTenderRejection([{ mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 2000 }], null);
    expect(msg).toBe("Choose what to do with the change, then confirm again.");
  });

  it("rejects tenderedPaise not greater than amountPaise", () => {
    const msg = cashTenderRejection(
      [{ mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 1000, changeAction: "handback" }],
      null,
    );
    expect(msg).toBe("Cash handed over must be more than the cash due when change is given.");
  });

  it("rejects khata change with no customer", () => {
    const msg = cashTenderRejection(
      [{ mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 1500, changeAction: "khata" }],
      null,
    );
    expect(msg).toBe("Keeping change on khata needs a customer on the bill.");
  });

  it("rejects khata change on a bill partly on credit", () => {
    const msg = cashTenderRejection(
      [
        { mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 1500, changeAction: "khata" },
        { mode: "credit", amountPaise: 500, refNo: null },
      ],
      "c1",
    );
    expect(msg).toBe("Change can't go to khata on a bill that is partly on credit — reduce the credit amount instead.");
  });

  it("accepts a valid handback", () => {
    const msg = cashTenderRejection(
      [{ mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 1500, changeAction: "handback" }],
      null,
    );
    expect(msg).toBeNull();
  });

  it("accepts a valid khata change", () => {
    const msg = cashTenderRejection(
      [{ mode: "cash", amountPaise: 1000, refNo: null, tenderedPaise: 1500, changeAction: "khata" }],
      "c1",
    );
    expect(msg).toBeNull();
  });
});
