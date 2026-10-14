import { describe, expect, it } from "vitest";

import { code128Svg } from "@/core/business-logic/code128.js";
import {
  A4_LABEL_PRESETS,
  buildLabelSheetHtml,
  DEFAULT_LABEL_LAYOUT,
  DEFAULT_ROLL_LAYOUT,
  defaultBestBefore,
  inStoreBarcode,
  labelLayoutOverflow,
  labelMonth,
  labelPageSizeMm,
  labelRupees,
  labelsPerSheet,
  parseLabelLayout,
  type ShelfLabel,
} from "@/core/business-logic/shelfLabel.js";

const ROLL = DEFAULT_ROLL_LAYOUT;

const label: ShelfLabel = {
  storeName: "Apple Super Market",
  productName: "Nilakadalai 100gm",
  barcode: "20000001",
  packedOn: "2026-10-07",
  expiryDate: "2027-01-07",
  mrpPaise: 3000,
  salePricePaise: 2450,
};

describe("formatting", () => {
  it("formats months as MM-YY", () => {
    expect(labelMonth("2026-10-07")).toBe("10-26");
    expect(labelMonth("nonsense")).toBe("—");
  });

  it("drops .00 from whole rupees only", () => {
    expect(labelRupees(3000)).toBe("30");
    expect(labelRupees(2450)).toBe("24.50");
    expect(labelRupees(5)).toBe("0.05");
    expect(labelRupees(0)).toBe("0");
  });

  it("builds the in-store barcode", () => {
    expect(inStoreBarcode(1)).toBe("20000001");
    expect(inStoreBarcode(1234567)).toBe("21234567");
  });

  it("adds the shelf life to the packed date", () => {
    expect(defaultBestBefore("2026-10-07", 90)).toBe("2027-01-05");
    expect(defaultBestBefore("2026-10-07", null)).toBeNull();
  });
});

describe("parseLabelLayout", () => {
  it("falls back to the default for missing or bad input", () => {
    expect(parseLabelLayout(undefined)).toEqual(DEFAULT_LABEL_LAYOUT);
    expect(parseLabelLayout("{not json")).toEqual(DEFAULT_LABEL_LAYOUT);
  });

  it("reads a layout saved before A4 sheets existed as the roll it was", () => {
    expect(parseLabelLayout(JSON.stringify({ columns: 3, widthMm: 35, heightMm: 25, gapMm: 2 }))).toEqual(ROLL);
  });

  it("clamps each field to its range", () => {
    const layout = parseLabelLayout(JSON.stringify({ paper: "roll", columns: 9, widthMm: 5, heightMm: 500, gapMm: -1 }));
    expect(layout).toEqual({ ...ROLL, columns: 6, widthMm: 15, heightMm: 150, gapMm: 0 });
  });

  it("keeps good values and defaults only the bad ones", () => {
    const layout = parseLabelLayout(JSON.stringify({ paper: "roll", columns: 2, widthMm: "x" }));
    expect(layout).toEqual({ ...ROLL, columns: 2 });
  });

  it("keeps an A4 layout's rows and margins, and ignores them on a roll", () => {
    const a4 = { ...DEFAULT_LABEL_LAYOUT, rows: 7, marginTopMm: 15.1 };
    expect(parseLabelLayout(JSON.stringify(a4))).toEqual(a4);
    expect(parseLabelLayout(JSON.stringify({ ...a4, paper: "roll" }))).toMatchObject({ rows: 1, marginTopMm: 0 });
  });
});

describe("labelPageSizeMm", () => {
  it("is one row of labels on a roll", () => {
    expect(labelPageSizeMm(ROLL)).toEqual({ widthMm: 109, heightMm: 25 });
    expect(labelPageSizeMm({ ...ROLL, columns: 1, widthMm: 50, heightMm: 30, gapMm: 3 })).toEqual({ widthMm: 50, heightMm: 30 });
  });

  it("is a whole A4 page on a sheet", () => {
    expect(labelPageSizeMm(DEFAULT_LABEL_LAYOUT)).toEqual({ widthMm: 210, heightMm: 297 });
  });
});

describe("A4 sheet layouts", () => {
  it("every preset fits on the page", () => {
    for (const preset of A4_LABEL_PRESETS) {
      expect(labelLayoutOverflow(preset.layout), preset.name).toBeNull();
    }
  });

  it("explains a layout that runs off the page", () => {
    expect(labelLayoutOverflow({ ...DEFAULT_LABEL_LAYOUT, columns: 4 })).toMatch(/more than A4's 210 mm/);
    expect(labelLayoutOverflow({ ...DEFAULT_LABEL_LAYOUT, rows: 9 })).toMatch(/more than A4's 297 mm/);
    expect(labelLayoutOverflow(ROLL)).toBeNull();
  });

  it("counts labels per sheet", () => {
    expect(labelsPerSheet(DEFAULT_LABEL_LAYOUT)).toBe(24);
    expect(labelsPerSheet(ROLL)).toBe(0);
  });
});

describe("buildLabelSheetHtml on a roll", () => {
  const rows = (html: string) => (html.match(/class="row/g) ?? []).length;
  const labels = (html: string) => (html.match(/class="label"/g) ?? []).length;

  it("makes one row per page: 10 copies over 3 columns is 4 rows", () => {
    const html = buildLabelSheetHtml(label, 10, ROLL);
    expect(rows(html)).toBe(4);
    expect(html.match(/page-break-after/g)?.length).toBe(1); // the rule; only 3 rows carry the class
    expect((html.match(/class="row brk"/g) ?? []).length).toBe(3);
    expect(labels(html)).toBe(10);
    expect((html.match(/class="label blank"/g) ?? []).length).toBe(2);
  });

  it("sets the page size from the layout", () => {
    expect(buildLabelSheetHtml(label, 1, ROLL)).toContain("size: 109mm 25mm; margin: 0");
  });

  it("keeps the small-label text size", () => {
    expect(buildLabelSheetHtml(label, 1, ROLL)).toContain(".store { font-size: 6.5pt");
  });
});

describe("buildLabelSheetHtml on an A4 sheet", () => {
  const A4 = DEFAULT_LABEL_LAYOUT; // 3 × 8, 63.5 × 33.9, gap 2.5, margins 12.9 / 7.2
  const sheets = (html: string) => (html.match(/class="sheet/g) ?? []).length;
  const positions = (html: string) => [...html.matchAll(/style="left:([\d.]+)mm;top:([\d.]+)mm"/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it("prints on A4 with no page margin of its own", () => {
    expect(buildLabelSheetHtml(label, 1, A4)).toContain("size: 210mm 297mm; margin: 0");
  });

  it("fills left to right, then top to bottom", () => {
    const html = buildLabelSheetHtml(label, 5, A4);
    expect(sheets(html)).toBe(1);
    expect(positions(html)).toEqual([
      [7.2, 12.9],
      [73.2, 12.9],
      [139.2, 12.9],
      [7.2, 46.8],
      [73.2, 46.8],
    ]);
  });

  it("carries on to a new sheet once one is full", () => {
    const html = buildLabelSheetHtml(label, 30, A4);
    expect(sheets(html)).toBe(2);
    expect((html.match(/class="sheet brk"/g) ?? []).length).toBe(1);
    expect(positions(html)).toHaveLength(30);
  });

  it("starts part-way down a used sheet, then moves to a fresh one", () => {
    const html = buildLabelSheetHtml(label, 5, A4, 23);
    expect(sheets(html)).toBe(2);
    const first = positions(html).slice(0, 2);
    expect(first).toEqual([
      [73.2, 250.2],
      [139.2, 250.2],
    ]);
    // The rest restart at the top-left of the next sheet.
    expect(positions(html)[2]).toEqual([7.2, 12.9]);
  });

  it("treats an out-of-range start position as the nearest valid one", () => {
    expect(positions(buildLabelSheetHtml(label, 1, A4, 0))[0]).toEqual([7.2, 12.9]);
    expect(positions(buildLabelSheetHtml(label, 1, A4, 99))[0]).toEqual([139.2, 250.2]);
  });

  it("makes the text bigger on a bigger label", () => {
    expect(buildLabelSheetHtml(label, 1, A4)).toContain(".store { font-size: 8.8pt");
  });
});

describe("buildLabelSheetHtml content", () => {
  it("prints the values the way the shop's labels read", () => {
    const html = buildLabelSheetHtml(label, 1, ROLL);
    expect(html).toContain("Apple Super Market");
    expect(html).toContain("Nilakadalai 100gm");
    expect(html).toContain("PKD : 10-26");
    expect(html).toContain("EXP : 01-27");
    expect(html).toContain("MRP : 30");
    expect(html).toContain("RS : 24.50");
  });

  it("includes the barcode drawing and its readable code", () => {
    const html = buildLabelSheetHtml(label, 1, ROLL);
    expect(html).toContain(code128Svg("20000001", { heightPx: 40, moduleWidth: 2 }));
    expect(html).toContain('<div class="code">20000001</div>');
  });

  it("shows a dash for unknown dates", () => {
    const html = buildLabelSheetHtml({ ...label, packedOn: null, expiryDate: null }, 1, ROLL);
    expect(html).toContain("PKD : —");
    expect(html).toContain("EXP : —");
  });

  it("escapes text", () => {
    const html = buildLabelSheetHtml({ ...label, productName: "<b>Dal & Rice</b>" }, 1, ROLL);
    expect(html).not.toContain("<b>Dal");
    expect(html).toContain("&lt;b&gt;Dal &amp; Rice&lt;/b&gt;");
  });
});
