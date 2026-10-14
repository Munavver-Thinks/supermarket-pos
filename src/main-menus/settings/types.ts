import type { ThemeId, ThemeSet } from "@pos/business-logic";

export interface ThemeChoice {
  set: ThemeSet;
  mode: "day" | "night";
  /** The `data-theme` the tile previews. */
  theme: Exclude<ThemeId, "contrast">;
  label: string;
  note: string;
}
