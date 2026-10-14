import { describe, expect, it } from "vitest";

import { parseUiLanguage, translate, UI_STRINGS } from "./uiStrings.js";

/** Full Tamil block. A `ta` value must contain at least one of these unless every word in it
 * is an allowlisted brand/acronym with no established Tamil spelling in shop use. */
const TAMIL_SCRIPT = /[஀-௿]/;

/** Words allowed to appear in a `ta` value without being translated. */
const LATIN_ALLOWED = new Set(["AI", "Supermarket", "POS"]);

function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string));
}

describe("UI_STRINGS", () => {
  it("has a non-empty en and ta for every key", () => {
    for (const [key, entry] of Object.entries(UI_STRINGS)) {
      expect(entry.en.trim().length, `${key}.en`).toBeGreaterThan(0);
      expect(entry.ta.trim().length, `${key}.ta`).toBeGreaterThan(0);
    }
  });

  it("writes every ta value in Tamil script, aside from allowlisted Latin words", () => {
    for (const [key, entry] of Object.entries(UI_STRINGS)) {
      if (TAMIL_SCRIPT.test(entry.ta)) continue;
      // No Tamil script at all: only acceptable if every word is on the allowlist.
      const words = entry.ta.split(/\s+/).filter(Boolean);
      const allAllowed = words.every((w) => LATIN_ALLOWED.has(w));
      expect(allAllowed, `${key}.ta ("${entry.ta}") has no Tamil script and isn't fully allowlisted`).toBe(true);
    }
  });

  it("matches the placeholder set between en and ta for every key", () => {
    for (const [key, entry] of Object.entries(UI_STRINGS)) {
      expect(placeholders(entry.ta), key).toEqual(placeholders(entry.en));
    }
  });
});

describe("parseUiLanguage", () => {
  it("accepts only 'ta', defaulting everything else (including undefined/null) to 'en'", () => {
    expect(parseUiLanguage("ta")).toBe("ta");
    expect(parseUiLanguage("en")).toBe("en");
    expect(parseUiLanguage("fr")).toBe("en");
    expect(parseUiLanguage(undefined)).toBe("en");
    expect(parseUiLanguage(null)).toBe("en");
  });
});

describe("translate", () => {
  it("resolves a real key in both languages", () => {
    expect(translate("nav.settings", "en")).toBe("Settings");
    expect(translate("nav.settings", "ta")).toBe(UI_STRINGS["nav.settings"].ta);
  });

  it("falls back to the key itself if it isn't in the dictionary", () => {
    expect(translate("nav.doesNotExist", "en")).toBe("nav.doesNotExist");
  });

  it("substitutes {name}-style placeholders, using an injected dictionary so the real string table needn't carry a test-only entry", () => {
    const fixture = { "test.greeting": { en: "Hello {name}", ta: "வணக்கம் {name}" } };
    expect(translate("test.greeting", "en", { name: "Rani" }, fixture)).toBe("Hello Rani");
    expect(translate("test.greeting", "ta", { name: "Rani" }, fixture)).toBe("வணக்கம் Rani");
  });
});
