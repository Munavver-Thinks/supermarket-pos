import { describe, expect, it } from "vitest";

import { parseQuantityInput } from "./quantityParser.js";

describe("parseQuantityInput", () => {
  it.each([
    ["2 milk", { productText: "milk", qty: 2, unit: null }],
    ["milk 2", { productText: "milk", qty: 2, unit: null }],
    ["2x milk", { productText: "milk", qty: 2, unit: null }],
    ["milk x2", { productText: "milk", qty: 2, unit: null }],
    ["rice 5kg", { productText: "rice", qty: 5, unit: "kg" }],
    ["1.85 kg tomato", { productText: "tomato", qty: 1.85, unit: "kg" }],
    ["2 packet sugar", { productText: "sugar", qty: 2, unit: "packet" }],
    ["aachi milagai", { productText: "aachi milagai", qty: 1, unit: null }],
  ])("parses %s", (input, expected) => {
    expect(parseQuantityInput(input)).toEqual(expected);
  });

  it("returns qty 1 for empty input", () => {
    expect(parseQuantityInput("")).toEqual({ productText: "", qty: 1, unit: null });
  });
});
