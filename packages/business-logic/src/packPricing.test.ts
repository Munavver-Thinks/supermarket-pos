import { describe, expect, it } from "vitest";

import { derivePackPrices } from "./packPricing.js";

describe("derivePackPrices", () => {
  const parent = {
    mrpPaise: 6500,
    salePricePaise: 6000,
    costPricePaise: 5000,
    wholesalePricePaise: null as number | null,
    isTaxInclusive: true,
  };

  it("scales every price by the pack fraction", () => {
    expect(derivePackPrices(parent, 1)).toEqual(parent);
    expect(derivePackPrices(parent, 0.5)).toEqual({
      mrpPaise: 3250,
      salePricePaise: 3000,
      costPricePaise: 2500,
      wholesalePricePaise: null,
      isTaxInclusive: true,
    });
  });

  it("rounds to the nearest paisa for a fraction that doesn't divide evenly", () => {
    // 6000 / 3 = 2000 exactly, but mrp 6500 / 3 = 2166.67 — must round, not truncate or throw.
    expect(derivePackPrices(parent, 1 / 3)).toEqual({
      mrpPaise: 2167,
      salePricePaise: 2000,
      costPricePaise: 1667,
      wholesalePricePaise: null,
      isTaxInclusive: true,
    });
  });

  it("carries the tax-inclusive flag through unchanged", () => {
    expect(derivePackPrices({ ...parent, isTaxInclusive: false }, 0.5).isTaxInclusive).toBe(false);
  });

  it("scales a wholesale rate the same way as every other price", () => {
    expect(derivePackPrices({ ...parent, wholesalePricePaise: 5500 }, 0.5).wholesalePricePaise).toBe(2750);
  });

  it("gives a child no wholesale rate when the parent has none, rather than deriving 0", () => {
    expect(derivePackPrices(parent, 0.5).wholesalePricePaise).toBeNull();
  });

  it("treats an omitted wholesale rate the same as an explicit null", () => {
    const { wholesalePricePaise: _omit, ...parentWithoutField } = parent;
    expect(derivePackPrices(parentWithoutField, 0.5).wholesalePricePaise).toBeNull();
  });
});
