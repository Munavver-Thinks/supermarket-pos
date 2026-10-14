import { code128Svg } from "./code128.js";
import { escapeHtml } from "./receiptLayout.js";

/** Everything printed on one shelf label. Dates are YYYY-MM-DD; money is integer paise. */
export interface ShelfLabel {
  storeName: string;
  productName: string;
  barcode: string;
  packedOn: string | null;
  expiryDate: string | null;
  mrpPaise: number;
  salePricePaise: number;
}

/** "roll": a label printer's roll, one row of labels per printed page. "a4": an A4 sticker
 * sheet on an ordinary printer, filled left to right, then top to bottom. */
export type LabelPaper = "roll" | "a4";

/**
 * Where the labels sit. Every field is always present; `rows`, `rowGapMm` and the two margins
 * only matter on an A4 sheet (a roll feeds one row at a time and has no margins).
 */
export interface LabelLayout {
  paper: LabelPaper;
  columns: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  /** Between columns. */
  gapMm: number;
  /** Between rows (A4 only). */
  rowGapMm: number;
  marginTopMm: number;
  marginLeftMm: number;
}

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** Common A4 sticker sheets. Measurements are the standard Avery/Novajet-style ones; a sheet
 * from another maker may differ by a millimetre, which the Settings fields can correct. */
export const A4_LABEL_PRESETS: ReadonlyArray<{ id: string; name: string; layout: LabelLayout }> = [
  {
    id: "a4-24",
    name: "A4 · 24 labels (3 × 8, 63.5 × 33.9 mm)",
    layout: { paper: "a4", columns: 3, rows: 8, widthMm: 63.5, heightMm: 33.9, gapMm: 2.5, rowGapMm: 0, marginTopMm: 12.9, marginLeftMm: 7.2 },
  },
  {
    id: "a4-21",
    name: "A4 · 21 labels (3 × 7, 63.5 × 38.1 mm)",
    layout: { paper: "a4", columns: 3, rows: 7, widthMm: 63.5, heightMm: 38.1, gapMm: 2.5, rowGapMm: 0, marginTopMm: 15.1, marginLeftMm: 7.2 },
  },
  {
    id: "a4-40",
    name: "A4 · 40 labels (4 × 10, 45.7 × 25.4 mm)",
    layout: { paper: "a4", columns: 4, rows: 10, widthMm: 45.7, heightMm: 25.4, gapMm: 2.6, rowGapMm: 0, marginTopMm: 21.5, marginLeftMm: 9.7 },
  },
  {
    id: "a4-65",
    name: "A4 · 65 labels (5 × 13, 38.1 × 21.2 mm)",
    layout: { paper: "a4", columns: 5, rows: 13, widthMm: 38.1, heightMm: 21.2, gapMm: 2.5, rowGapMm: 0, marginTopMm: 10.7, marginLeftMm: 4.7 },
  },
];

export const DEFAULT_LABEL_LAYOUT: LabelLayout = A4_LABEL_PRESETS[0]!.layout;

/** The 3-across label-printer roll this feature first shipped with. */
export const DEFAULT_ROLL_LAYOUT: LabelLayout = {
  paper: "roll",
  columns: 3,
  rows: 1,
  widthMm: 35,
  heightMm: 25,
  gapMm: 2,
  rowGapMm: 0,
  marginTopMm: 0,
  marginLeftMm: 0,
};

export const LABEL_LAYOUT_KEY = "label.layout";
export const LABEL_PRINTER_KEY = "label.printer";

function clamp(value: unknown, min: number, max: number, fallback: number, decimals: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const factor = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * factor) / factor;
}

/** Reads the saved layout; anything missing or unreadable falls back to the default, field by field. */
export function parseLabelLayout(raw: string | undefined | null): LabelLayout {
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_LABEL_LAYOUT;
  const obj = parsed as Record<string, unknown>;
  // A layout saved before A4 sheets existed has no `paper` and was a roll.
  const paper: LabelPaper = obj.paper === "a4" ? "a4" : "roll";
  const base = paper === "a4" ? DEFAULT_LABEL_LAYOUT : DEFAULT_ROLL_LAYOUT;
  return {
    paper,
    columns: clamp(obj.columns, 1, 6, base.columns, 0),
    rows: paper === "a4" ? clamp(obj.rows, 1, 30, base.rows, 0) : 1,
    widthMm: clamp(obj.widthMm, 15, 200, base.widthMm, 1),
    heightMm: clamp(obj.heightMm, 10, 150, base.heightMm, 1),
    gapMm: clamp(obj.gapMm, 0, 20, base.gapMm, 1),
    rowGapMm: paper === "a4" ? clamp(obj.rowGapMm, 0, 20, base.rowGapMm, 1) : 0,
    marginTopMm: paper === "a4" ? clamp(obj.marginTopMm, 0, 50, base.marginTopMm, 1) : 0,
    marginLeftMm: paper === "a4" ? clamp(obj.marginLeftMm, 0, 50, base.marginLeftMm, 1) : 0,
  };
}

/** How many labels one A4 sheet holds; 0 on a roll (it has no sheets). */
export function labelsPerSheet(layout: LabelLayout): number {
  return layout.paper === "a4" ? layout.columns * layout.rows : 0;
}

/** Why the labels would run off the A4 page, or null when they fit (always null on a roll). */
export function labelLayoutOverflow(layout: LabelLayout): string | null {
  if (layout.paper !== "a4") return null;
  const right = layout.marginLeftMm + layout.columns * layout.widthMm + (layout.columns - 1) * layout.gapMm;
  const bottom = layout.marginTopMm + layout.rows * layout.heightMm + (layout.rows - 1) * layout.rowGapMm;
  if (right > A4_WIDTH_MM + 0.05) return `The labels are ${Math.round(right * 10) / 10} mm wide — more than A4's 210 mm.`;
  if (bottom > A4_HEIGHT_MM + 0.05) return `The labels are ${Math.round(bottom * 10) / 10} mm tall — more than A4's 297 mm.`;
  return null;
}

/** "2026-10-07" -> "10-26". Anything that isn't a date reads as "—". */
export function labelMonth(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  return m ? `${m[2]}-${(m[1] ?? "").slice(2)}` : "—";
}

/** Whole rupees without ".00": 3000 -> "30", 2450 -> "24.50". */
export function labelRupees(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/** An A4 sheet, or on a roll one row of labels — roll printers feed a row at a time. */
export function labelPageSizeMm(layout: LabelLayout): { widthMm: number; heightMm: number } {
  if (layout.paper === "a4") return { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM };
  const widthMm = Math.round((layout.columns * layout.widthMm + (layout.columns - 1) * layout.gapMm) * 10) / 10;
  return { widthMm, heightMm: layout.heightMm };
}

/** The in-store barcode for a sequence number: "2" + 7 digits, e.g. 1 -> "20000001". */
export function inStoreBarcode(seq: number): string {
  return `2${String(seq).padStart(7, "0")}`;
}

/** Packed date plus the product's shelf life; null when no shelf life is set. */
export function defaultBestBefore(packedOn: string, shelfLifeDays: number | null): string | null {
  if (shelfLifeDays === null || !Number.isFinite(shelfLifeDays)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(packedOn);
  if (!m) return null;
  // UTC, so a DST change can't skip or repeat a day.
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  date.setUTCDate(date.getUTCDate() + shelfLifeDays);
  return date.toISOString().slice(0, 10);
}

function labelHtml(label: ShelfLabel): string {
  const pkd = label.packedOn ? labelMonth(label.packedOn) : "—";
  const exp = label.expiryDate ? labelMonth(label.expiryDate) : "—";
  return `<div class="label">
  <div class="store">${escapeHtml(label.storeName)}</div>
  <div class="name">${escapeHtml(label.productName)}</div>
  <div class="bc"><div class="bars">${code128Svg(label.barcode, { heightPx: 40, moduleWidth: 2 })}</div><div class="code">${escapeHtml(label.barcode)}</div></div>
  <div class="kv"><span>PKD : ${escapeHtml(pkd)}</span><span>MRP : ${escapeHtml(labelRupees(label.mrpPaise))}</span></div>
  <div class="kv"><span>EXP : ${escapeHtml(exp)}</span><span>RS : ${escapeHtml(labelRupees(label.salePricePaise))}</span></div>
</div>`;
}

/** The text sizes are tuned for a 35 × 25 mm label; bigger labels get proportionally bigger text. */
function textScale(layout: LabelLayout): number {
  const scale = Math.min(layout.widthMm / 35, layout.heightMm / 25);
  return Math.round(Math.min(1.8, Math.max(1, scale)) * 100) / 100;
}

function labelCss(layout: LabelLayout, pageWidthMm: number, pageHeightMm: number): string {
  const s = textScale(layout);
  const pt = (size: number): string => `${Math.round(size * s * 10) / 10}pt`;
  return `@page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; }
.row { display: flex; gap: ${layout.gapMm}mm; width: ${pageWidthMm}mm; height: ${pageHeightMm - 0.3}mm; overflow: hidden; }
.sheet { position: relative; width: ${pageWidthMm}mm; height: ${pageHeightMm - 0.3}mm; overflow: hidden; }
.sheet .label { position: absolute; }
.brk { page-break-after: always; }
.label { width: ${layout.widthMm}mm; height: ${layout.heightMm - 0.3}mm; padding: 1mm 1.2mm; display: flex; flex-direction: column; overflow: hidden; line-height: 1.15; }
.store { font-size: ${pt(6.5)}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name { font-size: ${pt(6.5)}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc { flex: 1; min-height: 0; display: flex; align-items: stretch; gap: 0.5mm; margin: 0.4mm 0; }
.bars { flex: 1; min-width: 0; }
.bars svg { width: 100%; height: 100%; display: block; }
.code { writing-mode: vertical-rl; font-size: ${pt(5)}; line-height: 1; text-align: center; }
.kv { display: flex; justify-content: space-between; font-size: ${pt(6)}; font-weight: 700; white-space: nowrap; }`;
}

/**
 * HTML for `copies` identical labels.
 *
 * Roll: one row of `layout.columns` labels per printed page, left to right; the last row's
 * unused slots stay blank.
 *
 * A4: labels fill each sheet left to right, then top to bottom, and carry on to the next sheet.
 * `startAt` (1-based, A4 only) skips the positions already peeled off a partly used sheet, so
 * the first label lands on position `startAt` of the first sheet.
 */
export function buildLabelSheetHtml(label: ShelfLabel, copies: number, layout: LabelLayout, startAt = 1): string {
  const { widthMm, heightMm } = labelPageSizeMm(layout);
  const total = Math.max(1, Math.floor(copies));
  const one = labelHtml(label);
  const pages: string[] = [];

  if (layout.paper === "a4") {
    const perSheet = labelsPerSheet(layout);
    const skip = Math.min(Math.max(1, Math.floor(startAt)), perSheet) - 1;
    const sheetCount = Math.ceil((skip + total) / perSheet);
    for (let p = 0; p < sheetCount; p++) {
      const slots: string[] = [];
      for (let i = 0; i < perSheet; i++) {
        const position = p * perSheet + i;
        if (position < skip || position >= skip + total) continue;
        const row = Math.floor(i / layout.columns);
        const col = i % layout.columns;
        const left = Math.round((layout.marginLeftMm + col * (layout.widthMm + layout.gapMm)) * 100) / 100;
        const top = Math.round((layout.marginTopMm + row * (layout.heightMm + layout.rowGapMm)) * 100) / 100;
        slots.push(one.replace('<div class="label">', `<div class="label" style="left:${left}mm;top:${top}mm">`));
      }
      pages.push(`<div class="sheet${p < sheetCount - 1 ? " brk" : ""}">${slots.join("")}</div>`);
    }
  } else {
    const rowCount = Math.ceil(total / layout.columns);
    for (let r = 0; r < rowCount; r++) {
      const slots: string[] = [];
      for (let c = 0; c < layout.columns; c++) {
        slots.push(r * layout.columns + c < total ? one : `<div class="label blank"></div>`);
      }
      pages.push(`<div class="row${r < rowCount - 1 ? " brk" : ""}">${slots.join("")}</div>`);
    }
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${labelCss(layout, widthMm, heightMm)}
</style></head><body>${pages.join("")}</body></html>`;
}
