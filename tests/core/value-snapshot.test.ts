import { describe, expect, it } from "vitest";

import type { ValueSnapshot } from "../../src/shared/trace-types";
import { cloneValueSnapshot, valueSnapshotsEqual } from "../../src/core/value-snapshot";

describe("valueSnapshotsEqual", () => {
  it("compares snapshot data rather than object property insertion order", () => {
    const first = {
      type: "unknown",
      className: "Node",
      repr: "<Node>"
    } as ValueSnapshot;
    const second = {
      repr: "<Node>",
      type: "unknown",
      className: "Node"
    } as ValueSnapshot;

    expect(valueSnapshotsEqual(first, second)).toBe(true);
  });

  it("clones and compares object references by stable object id and class", () => {
    const reference = {
      type: "reference",
      objectId: "obj-7",
      className: "ListNode"
    } as const;

    expect(cloneValueSnapshot(reference)).toEqual(reference);
    expect(valueSnapshotsEqual(reference, { ...reference })).toBe(true);
    expect(valueSnapshotsEqual(reference, { ...reference, objectId: "obj-8" })).toBe(false);
  });
});
