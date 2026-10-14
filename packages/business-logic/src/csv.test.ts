import { describe, expect, it } from "vitest";

import { paiseForCsv, toCsv } from "./csv.js";

describe("toCsv", () => {
  it("writes a header row and data rows separated by CRLF", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2");
  });

  it("quotes fields containing a comma", () => {
    // Without this the row silently gains a column and every figure after it shifts.
    expect(toCsv(["name"], [["Toor Dal, 1kg"]])).toBe('name\r\n"Toor Dal, 1kg"');
  });

  it("doubles embedded quotes", () => {
    expect(toCsv(["name"], [['Rice "premium"']])).toBe('name\r\n"Rice ""premium"""');
  });

  it("quotes fields containing a newline", () => {
    expect(toCsv(["note"], [["line one\nline two"]])).toBe('note\r\n"line one\nline two"');
  });

  it("writes null as an empty field", () => {
    expect(toCsv(["a", "b"], [[null, 1]])).toBe("a,b\r\n,1");
  });

  it("handles no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });
});

describe("paiseForCsv", () => {
  it("writes a plain decimal a spreadsheet reads as a number", () => {
    expect(paiseForCsv(123456)).toBe("1234.56");
    expect(paiseForCsv(5)).toBe("0.05");
    expect(paiseForCsv(0)).toBe("0.00");
  });

  it("keeps negatives signed", () => {
    expect(paiseForCsv(-2500)).toBe("-25.00");
  });
});
