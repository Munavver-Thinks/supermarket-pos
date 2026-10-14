import { DEFAULT_THEME_PREFERENCE } from "@pos/business-logic";
import { describe, expect, it } from "vitest";

import { THEME_CHOICES } from "./constants.js";
import { currentChoice, describeThemePreference } from "./themeChoices.js";

describe("describeThemePreference", () => {
  it("names the set and mode, or high contrast", () => {
    expect(describeThemePreference({ ...DEFAULT_THEME_PREFERENCE, set: "calm", mode: "day", highContrast: false })).toBe("Calm · Day");
    expect(describeThemePreference({ ...DEFAULT_THEME_PREFERENCE, set: "vivid", mode: "auto", highContrast: false })).toBe("Vivid · Auto");
    expect(describeThemePreference({ ...DEFAULT_THEME_PREFERENCE, highContrast: true })).toBe("High contrast");
  });
});

describe("currentChoice", () => {
  it("matches the tile for a fixed day or night preference", () => {
    const day = currentChoice({ ...DEFAULT_THEME_PREFERENCE, set: "vivid", mode: "day", highContrast: false });
    expect(day.theme).toBe("vivid");
    const night = currentChoice({ ...DEFAULT_THEME_PREFERENCE, set: "calm", mode: "night", highContrast: false });
    expect(night.theme).toBe("dark");
    expect(THEME_CHOICES).toContain(night);
  });
});
