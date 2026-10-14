import { resolveTheme, type ThemeId, type ThemeMode, type ThemePreference, type ThemeSet } from "@pos/business-logic";

export interface ThemeChoice {
  set: ThemeSet;
  mode: "day" | "night";
  /** The `data-theme` the tile previews. */
  theme: Exclude<ThemeId, "contrast">;
  label: string;
  note: string;
}

export const THEME_CHOICES: ThemeChoice[] = [
  { set: "calm", mode: "day", theme: "light", label: "Calm · Day", note: "Warm paper, soft colours" },
  { set: "calm", mode: "night", theme: "dark", label: "Calm · Night", note: "Soft dark green" },
  { set: "vivid", mode: "day", theme: "vivid", label: "Vivid · Day", note: "Bright white, bold colours" },
  { set: "vivid", mode: "night", theme: "vivid-night", label: "Vivid · Night", note: "Deep navy, neon colours" },
];

const MODE_LABEL: Record<ThemeMode, string> = { day: "Day", night: "Night", auto: "Auto" };

/** "Calm · Day", "Vivid · Auto", or "High contrast" — what a preference is called on screen. */
export function describeThemePreference(pref: ThemePreference): string {
  if (pref.highContrast) return "High contrast";
  return `${pref.set === "vivid" ? "Vivid" : "Calm"} · ${MODE_LABEL[pref.mode]}`;
}

/** The tile that matches what is on screen now (the colour set, ignoring high contrast). */
export function currentChoice(pref: ThemePreference): ThemeChoice {
  const theme = resolveTheme({ ...pref, highContrast: false }, new Date());
  return THEME_CHOICES.find((choice) => choice.theme === theme) ?? THEME_CHOICES[0]!;
}

/** The small two-colour chip used in the quick switch rows. */
export function ThemeSwatch({ theme }: { theme: ThemeId }): JSX.Element {
  return (
    <span className="theme-swatch" data-theme={theme} aria-hidden="true">
      <i className="theme-swatch-sun" />
      <i className="theme-swatch-brand" />
    </span>
  );
}

function PreviewRow(): JSX.Element {
  return (
    <div className="theme-tile-row">
      <i className="theme-tile-line wide" />
      <i className="theme-tile-line short" />
    </div>
  );
}

/** A miniature billing screen drawn in the tile's own theme tokens. */
function TilePreview({ theme }: { theme: ThemeId }): JSX.Element {
  return (
    <div className="theme-tile-preview" data-theme={theme} aria-hidden="true">
      <div className="theme-tile-rail">
        <i className="theme-tile-logo" />
        <i className="theme-tile-nav active" />
        <i className="theme-tile-nav" />
        <i className="theme-tile-nav" />
      </div>
      <div className="theme-tile-main">
        <div className="theme-tile-list">
          <PreviewRow />
          <PreviewRow />
          <PreviewRow />
          <PreviewRow />
          <i className="theme-tile-warn" />
        </div>
        <div className="theme-tile-side">
          <div className="theme-tile-total">{"₹773"}</div>
          <div className="theme-tile-chip" />
          <div className="theme-tile-pay">Pay</div>
        </div>
      </div>
    </div>
  );
}

interface ThemeTilesProps {
  value: ThemePreference;
  onSelect: (choice: ThemeChoice) => void;
}

/** Four live preview tiles — one radio each. Picking one sets the colour set and Day/Night. */
export function ThemeTiles({ value, onSelect }: ThemeTilesProps): JSX.Element {
  const current = currentChoice(value);
  return (
    <div className={"theme-tiles" + (value.highContrast ? " dimmed" : "")} role="radiogroup" aria-label="Colour set">
      {THEME_CHOICES.map((choice) => {
        const selected = choice === current;
        return (
          <label key={choice.theme} className={"theme-tile" + (selected ? " selected" : "")}>
            <input
              type="radio"
              name="appearance-tile"
              className="theme-tile-input"
              checked={selected}
              onChange={() => onSelect(choice)}
            />
            <TilePreview theme={choice.theme} />
            <span className="theme-tile-name">
              <span className="theme-tile-dot" aria-hidden="true" />
              <b>{choice.label}</b>
            </span>
            <span className="theme-tile-note">{choice.note}</span>
          </label>
        );
      })}
    </div>
  );
}
