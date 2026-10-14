import { useEffect, useState } from "react";
import {
  A4_LABEL_PRESETS,
  canChangeStoreSettings,
  DEFAULT_LABEL_LAYOUT,
  DEFAULT_ROLL_LAYOUT,
  labelLayoutOverflow,
  type LabelLayout,
  type LabelPaper,
} from "@pos/business-logic";

import { labelsService } from "@/services/labelsService.js";

import { BlueprintCard } from "../../components/BlueprintCard.js";
import { useSessionStore } from "../../store/sessionStore.js";

type NumberField = Exclude<keyof LabelLayout, "paper">;
type Texts = Record<NumberField, string>;

const NUMBER_FIELDS: NumberField[] = [
  "columns",
  "rows",
  "widthMm",
  "heightMm",
  "gapMm",
  "rowGapMm",
  "marginTopMm",
  "marginLeftMm",
];

/** Allowed range per field — the same limits the main process enforces. */
const LIMITS: Record<NumberField, { min: number; max: number; whole?: boolean }> = {
  columns: { min: 1, max: 6, whole: true },
  rows: { min: 1, max: 30, whole: true },
  widthMm: { min: 15, max: 200 },
  heightMm: { min: 10, max: 150 },
  gapMm: { min: 0, max: 20 },
  rowGapMm: { min: 0, max: 20 },
  marginTopMm: { min: 0, max: 50 },
  marginLeftMm: { min: 0, max: 50 },
};

function toTexts(layout: LabelLayout): Texts {
  const texts = {} as Texts;
  for (const field of NUMBER_FIELDS) texts[field] = String(layout[field]);
  return texts;
}

/** The preset a layout exactly matches, so the dropdown shows it; "custom" otherwise. */
function presetIdFor(paper: LabelPaper, texts: Texts): string {
  if (paper !== "a4") return "custom";
  const match = A4_LABEL_PRESETS.find((p) => NUMBER_FIELDS.every((f) => Number(texts[f]) === p.layout[f]));
  return match?.id ?? "custom";
}

/** Which printer shelf labels go to, and how they sit on a roll or an A4 sheet — owner or manager to change. */
export function LabelSettingsCard({ printers }: { printers: string[] }): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const [printerName, setPrinterName] = useState("");
  const [paper, setPaper] = useState<LabelPaper>(DEFAULT_LABEL_LAYOUT.paper);
  const [texts, setTexts] = useState<Texts>(toTexts(DEFAULT_LABEL_LAYOUT));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    labelsService
      .getSettings()
      .then((s) => {
        const { printerName: name, ...layout } = s;
        setPrinterName(name ?? "");
        setPaper(layout.paper);
        setTexts(toTexts(layout));
        setLoaded(true);
      })
      .catch(() => setMessage("Could not load this setting."));
  }, []);

  const canEdit = user ? canChangeStoreSettings(user.role) : false;
  // A saved printer that is no longer detected must stay selectable, or saving would silently drop it.
  const printerOptions = printerName && !printers.includes(printerName) ? [printerName, ...printers] : printers;

  const layout = { paper } as LabelLayout;
  let inRange = true;
  for (const field of NUMBER_FIELDS) {
    const value = Number(texts[field]);
    const limit = LIMITS[field];
    layout[field] = value;
    if (texts[field].trim() === "" || !Number.isFinite(value) || value < limit.min || value > limit.max) inRange = false;
    if (limit.whole && !Number.isInteger(value)) inRange = false;
  }
  const overflow = inRange ? labelLayoutOverflow(layout) : null;
  const valid = inRange && overflow === null;
  const isA4 = paper === "a4";

  function setField(field: NumberField, value: string): void {
    setTexts((prev) => ({ ...prev, [field]: value }));
  }

  function choosePaper(next: LabelPaper): void {
    setPaper(next);
    setTexts(toTexts(next === "a4" ? DEFAULT_LABEL_LAYOUT : DEFAULT_ROLL_LAYOUT));
  }

  function choosePreset(id: string): void {
    const preset = A4_LABEL_PRESETS.find((p) => p.id === id);
    if (preset) setTexts(toTexts(preset.layout));
  }

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user || !valid) return;
    setBusy(true);
    setMessage(null);
    const result = await labelsService.setSettings({ printerName: printerName || null, ...layout }, user.id);
    setBusy(false);
    setMessage(result.ok ? "Saved. Applies to the next labels printed." : (result.error ?? "Could not save the setting."));
  }

  function numberInput(field: NumberField, label: string, step: string): JSX.Element {
    const limit = LIMITS[field];
    return (
      <div className="field">
        <label htmlFor={`label-${field}`}>{label}</label>
        <input
          id={`label-${field}`}
          type="number"
          min={limit.min}
          max={limit.max}
          step={step}
          value={texts[field]}
          onChange={(e) => setField(field, e.target.value)}
        />
      </div>
    );
  }

  return (
    <BlueprintCard>
      <h2>Label printer</h2>
      <p className="note settings-note">
        Shelf labels print here, never on the receipt roll. With "Ask every time" you pick a printer in the print window.
      </p>
      <form onSubmit={(e) => void handleSave(e)}>
        <fieldset disabled={!canEdit || !loaded || busy} className="settings-fieldset">
          <div className="form-grid-2">
            <div className="field">
              <label htmlFor="label-printer">Printer</label>
              <select id="label-printer" value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                <option value="">Ask every time</option>
                {printerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="label-paper">Paper</label>
              <select id="label-paper" value={paper} onChange={(e) => choosePaper(e.target.value as LabelPaper)}>
                <option value="a4">A4 sticker sheet</option>
                <option value="roll">Label printer roll</option>
              </select>
            </div>
          </div>

          {isA4 && (
            <div className="field">
              <label htmlFor="label-preset">Sheet</label>
              <select id="label-preset" value={presetIdFor(paper, texts)} onChange={(e) => choosePreset(e.target.value)}>
                {A4_LABEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="custom">Custom — measure your sheet</option>
              </select>
            </div>
          )}

          <div className="form-grid-2">
            {numberInput("columns", "Labels across", "1")}
            {isA4 && numberInput("rows", "Rows per sheet", "1")}
            {numberInput("widthMm", "Label width (mm)", "0.1")}
            {numberInput("heightMm", "Label height (mm)", "0.1")}
            {numberInput("gapMm", "Gap between labels (mm)", "0.1")}
            {isA4 && numberInput("rowGapMm", "Gap between rows (mm)", "0.1")}
            {isA4 && numberInput("marginTopMm", "Top margin (mm)", "0.1")}
            {isA4 && numberInput("marginLeftMm", "Left margin (mm)", "0.1")}
          </div>
          {isA4 && (
            <p className="note settings-note">
              Labels fill each sheet left to right, then top to bottom. Measure the margins from the sheet's edge to the
              first label. If the print sits a little off, nudge the margins.
            </p>
          )}
          <button type="submit" className="primary-btn" disabled={!valid}>
            Save
          </button>
        </fieldset>
      </form>
      {!inRange && loaded && (
        <div className="error-text">
          Labels across 1–6, rows 1–30, width 15–200 mm, height 10–150 mm, gaps 0–20 mm, margins 0–50 mm.
        </div>
      )}
      {overflow && <div className="error-text">{overflow}</div>}
      {message && <div className="settings-message">{message}</div>}
      {!canEdit && <div className="note settings-foot">Only an owner or manager can change this.</div>}
    </BlueprintCard>
  );
}
