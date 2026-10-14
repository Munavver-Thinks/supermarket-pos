import type { ThemeChoice } from "./types.js";

export const THEME_CHOICES: ThemeChoice[] = [
  { set: "calm", mode: "day", theme: "light", label: "Calm · Day", note: "Warm paper, soft colours" },
  { set: "calm", mode: "night", theme: "dark", label: "Calm · Night", note: "Soft dark green" },
  { set: "vivid", mode: "day", theme: "vivid", label: "Vivid · Day", note: "Bright white, bold colours" },
  { set: "vivid", mode: "night", theme: "vivid-night", label: "Vivid · Night", note: "Deep navy, neon colours" },
];
