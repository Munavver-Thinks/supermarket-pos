import { describe, expect, it } from "vitest";

import {
  isNightHour,
  parseThemePreference,
  resolveTheme,
  serializeThemePreference,
  themeSettingKey,
  type ThemeId,
  type ThemePreference,
} from "@/core/business-logic/themePreference.js";

const DEFAULTS: ThemePreference = { set: "calm", mode: "day", highContrast: false };
const at = (h: number, m = 0): Date => new Date(2026, 0, 15, h, m, 0);

describe("themeSettingKey", () => {
  it("is per user", () => {
    expect(themeSettingKey("abc")).toBe("ui.theme.abc");
  });
});

describe("parseThemePreference", () => {
  it("defaults for missing values", () => {
    expect(parseThemePreference(null)).toEqual(DEFAULTS);
    expect(parseThemePreference(undefined)).toEqual(DEFAULTS);
    expect(parseThemePreference("")).toEqual(DEFAULTS);
  });

  it("defaults for bad JSON and non-objects", () => {
    expect(parseThemePreference("{nope")).toEqual(DEFAULTS);
    expect(parseThemePreference("null")).toEqual(DEFAULTS);
    expect(parseThemePreference("42")).toEqual(DEFAULTS);
    expect(parseThemePreference("[]")).toEqual(DEFAULTS);
    expect(parseThemePreference('"vivid"')).toEqual(DEFAULTS);
  });

  it("falls back field by field for partial or unknown values", () => {
    expect(parseThemePreference('{"set":"vivid"}')).toEqual({ ...DEFAULTS, set: "vivid" });
    expect(parseThemePreference('{"mode":"auto","highContrast":true}')).toEqual({
      set: "calm",
      mode: "auto",
      highContrast: true,
    });
    expect(parseThemePreference('{"set":"neon","mode":"dusk","highContrast":"yes"}')).toEqual(DEFAULTS);
    expect(parseThemePreference('{"set":"vivid","mode":"dusk"}')).toEqual({ ...DEFAULTS, set: "vivid" });
  });

  it("round-trips every valid preference", () => {
    for (const set of ["calm", "vivid"] as const) {
      for (const mode of ["day", "night", "auto"] as const) {
        for (const highContrast of [false, true]) {
          const pref = { set, mode, highContrast };
          expect(parseThemePreference(serializeThemePreference(pref))).toEqual(pref);
        }
      }
    }
  });
});

describe("isNightHour", () => {
  it("covers the 19:00 and 07:00 boundaries", () => {
    expect(isNightHour(at(18, 59))).toBe(false);
    expect(isNightHour(at(19, 0))).toBe(true);
    expect(isNightHour(at(23, 59))).toBe(true);
    expect(isNightHour(at(0, 0))).toBe(true);
    expect(isNightHour(at(6, 59))).toBe(true);
    expect(isNightHour(at(7, 0))).toBe(false);
    expect(isNightHour(at(12, 0))).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("covers every combination", () => {
    for (const set of ["calm", "vivid"] as const) {
      for (const mode of ["day", "night", "auto"] as const) {
        for (const highContrast of [false, true]) {
          for (const [now, night] of [
            [at(12), false],
            [at(22), true],
          ] as const) {
            const isNight = mode === "night" || (mode === "auto" && night);
            let expected: ThemeId;
            if (highContrast) expected = "contrast";
            else if (set === "calm") expected = isNight ? "dark" : "light";
            else expected = isNight ? "vivid-night" : "vivid";
            expect(resolveTheme({ set, mode, highContrast }, now)).toBe(expected);
          }
        }
      }
    }
  });

  it("auto switches at the boundaries", () => {
    const auto: ThemePreference = { set: "calm", mode: "auto", highContrast: false };
    expect(resolveTheme(auto, at(18, 59))).toBe("light");
    expect(resolveTheme(auto, at(19, 0))).toBe("dark");
    expect(resolveTheme(auto, at(6, 59))).toBe("dark");
    expect(resolveTheme(auto, at(7, 0))).toBe("light");
    expect(resolveTheme({ ...auto, set: "vivid" }, at(19, 0))).toBe("vivid-night");
  });
});
