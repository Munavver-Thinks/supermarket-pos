import { describe, expect, it } from "vitest";

import {
  applyPercent,
  extractTaxableFromInclusive,
  formatIndianCurrency,
  roundToNearestRupee,
  rupeesToPaise,
} from "./money.js";

describe("money", () => {
  it("converts rupees to paise", () => {
    expect(rupeesToPaise(60)).toBe(6000);
    expect(rupeesToPaise(111)).toBe(11100);
    expect(rupeesToPaise(1.85 * 60)).toBe(11100);
  });

  it("applies a percent discount rounded to the nearest paisa", () => {
    expect(applyPercent(10000, 10)).toBe(1000);
    expect(applyPercent(333, 10)).toBe(33);
  });

  it("extracts taxable value from a tax-inclusive amount", () => {
    // 118 inclusive at 18% => 100 taxable, 18 tax
    expect(extractTaxableFromInclusive(11800, 18)).toBe(10000);
    // 0% tax: taxable equals inclusive
    expect(extractTaxableFromInclusive(5000, 0)).toBe(5000);
  });

  it("rounds the bill total to the nearest rupee", () => {
    expect(roundToNearestRupee(11149)).toEqual({ roundOffPaise: -49, roundedPaise: 11100 });
    expect(roundToNearestRupee(11151)).toEqual({ roundOffPaise: 49, roundedPaise: 11200 });
    expect(roundToNearestRupee(11150)).toEqual({ roundOffPaise: 50, roundedPaise: 11200 });
  });

  it("formats paise with Indian digit grouping", () => {
    expect(formatIndianCurrency(12345675)).toBe("₹1,23,456.75");
    expect(formatIndianCurrency(100)).toBe("₹1.00");
    expect(formatIndianCurrency(0)).toBe("₹0.00");
    expect(formatIndianCurrency(-500)).toBe("-₹5.00");
  });
});
