import { describe, expect, it } from "vitest";

import { formatValue } from "../../src/sidepanel/components/value-format";

describe("formatValue", () => {
  it("formats object references with their class and stable id", () => {
    expect(formatValue({
      type: "reference",
      objectId: "obj-7",
      className: "ListNode"
    })).toBe("ListNode@obj-7");
  });
});
