import type { ThemeId, ThemePreference } from "@pos/business-logic";

import { THEME_CHOICES } from "../constants.js";
import { currentChoice } from "../themeChoices.js";
import type { ThemeChoice } from "../types.js";

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
