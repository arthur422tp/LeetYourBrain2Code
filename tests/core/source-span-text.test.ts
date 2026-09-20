import { describe, expect, it } from "vitest";

import {
  normalizeCrossRunSource,
  sliceSourceSpan
} from "../../src/core/source-span-text";

describe("source span text", () => {
  it("slices single-line and multi-line spans deterministically", () => {
    const source = "first line\nsecond line\nthird line";
    expect(sliceSourceSpan(source, { line: 1, column: 6, endLine: 1, endColumn: 10 }))
      .toBe("line");
    expect(sliceSourceSpan(source, { line: 1, column: 6, endLine: 2, endColumn: 6 }))
      .toBe("line\nsecond");
  });

  it("handles line shifts by reading the supplied source rather than a global line key", () => {
    const baseline = "class Solution:\n    if value < target:\n        return value\n";
    const current = "class Solution:\n    # inserted\n    if value < target:\n        return value\n";

    expect(sliceSourceSpan(baseline, { line: 2, column: 4, endLine: 2, endColumn: 22 }))
      .toBe("if value < target:");
    expect(sliceSourceSpan(current, { line: 3, column: 4, endLine: 3, endColumn: 22 }))
      .toBe("if value < target:");
  });

  it("normalizes only non-semantic whitespace and preserves string literal contents", () => {
    expect(normalizeCrossRunSource("  nums[i]   <   target  \r\n"))
      .toBe("nums[i] < target");
    expect(normalizeCrossRunSource("  \"a   b\"  "))
      .toBe("\"a   b\"");
    expect(normalizeCrossRunSource("left\n  + right"))
      .toBe("left + right");
  });
});
