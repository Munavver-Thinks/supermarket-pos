import { describe, expect, it } from "vitest";

import { formatSize } from "@/utils/format.js";

describe("formatSize", () => {
  it("uses bytes, KB and MB at the right boundaries", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});
