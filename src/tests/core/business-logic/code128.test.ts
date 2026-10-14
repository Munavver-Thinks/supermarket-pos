import { describe, expect, it } from "vitest";

import { code128Modules, code128Svg, code128Values } from "@/core/business-logic/code128.js";

describe("code128Values", () => {
  it("uses set C for an even-length digit string", () => {
    expect(code128Values("9286")).toEqual([105, 92, 86, 60, 106]);
  });

  it("encodes an odd-length digit string as set C pairs, then switches to B for the last digit", () => {
    // Start C, "12", Code B, "3" (ASCII 51 - 32 = 19); 105 + 12*1 + 100*2 + 19*3 = 374; mod 103 = 65
    expect(code128Values("123")).toEqual([105, 12, 100, 19, 65, 106]);
  });

  it("keeps a 13-digit EAN narrower than all-set-B would", () => {
    const values = code128Values("8901234567890");
    expect(values[0]).toBe(105);
    expect(values).toHaveLength(1 + 6 + 2 + 1 + 1); // start, 6 pairs, Code B + digit, check, stop
  });

  it("uses set B for a single digit", () => {
    expect(code128Values("7")[0]).toBe(104);
  });

  it("uses set B for letters, with the checksum from start + value x position", () => {
    // 104 + 33*1 + 34*2 + 35*3 = 310; 310 mod 103 = 1
    expect(code128Values("ABC")).toEqual([104, 33, 34, 35, 1, 106]);
  });

  it("rejects empty text and characters outside ASCII 32-126", () => {
    expect(() => code128Values("")).toThrow(/empty/);
    expect(() => code128Values("aé")).toThrow(/can't print/);
    expect(() => code128Values("a\tb")).toThrow(/can't print/);
  });
});

describe("code128Modules", () => {
  it("is 11 modules per symbol plus a 13-module stop", () => {
    const symbols = code128Values("20000001").length;
    expect(code128Modules("20000001")).toHaveLength(11 * (symbols - 1) + 13);
    expect(code128Modules("ABC")).toHaveLength(11 * 5 + 13);
  });

  it("starts with a bar and ends with the stop pattern", () => {
    const modules = code128Modules("9286");
    expect(modules.startsWith("11010011100")).toBe(true); // start C
    expect(modules.endsWith("1100011101011")).toBe(true);
  });
});

describe("code128Svg", () => {
  it("draws bars with quiet zones either side", () => {
    const svg = code128Svg("9286", { heightPx: 30, moduleWidth: 2 });
    const modules = code128Modules("9286").length;
    expect(svg).toContain(`width="${(modules + 20) * 2}"`);
    expect(svg).toContain('height="30"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // The first bar starts after the 10-module quiet zone.
    expect(svg).toContain('<rect x="20"');
  });
});
