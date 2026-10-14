import { describe, expect, it } from "vitest";

import { afterFirstLine } from "./text.js";

describe("afterFirstLine", () => {
  it("returns everything after the first newline", () => {
    expect(afterFirstLine("Title\nBody line\nMore")).toBe("Body line\nMore");
  });
  it("returns the text unchanged when there is no newline", () => {
    expect(afterFirstLine("Only one line")).toBe("Only one line");
  });
});
