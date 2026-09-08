import { describe, expect, it } from "vitest";

import type { ValueSnapshot } from "../../src/shared/trace-types";
import {
  cloneValueSnapshot,
  isValueSnapshotComplete,
  valueSnapshotsEqual
} from "../../src/core/value-snapshot";

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

describe("isValueSnapshotComplete", () => {
  it("rejects recursively truncated snapshots", () => {
    expect(isValueSnapshotComplete({
      type: "list",
      length: 1,
      truncated: false,
      items: [{ type: "str", value: "abc", length: 9, truncated: true }]
    })).toBe(false);
  });

  it("accepts complete nested snapshots", () => {
    expect(isValueSnapshotComplete({
      type: "dict",
      length: 1,
      truncated: false,
      entries: [{
        key: { type: "str", value: "x", length: 1, truncated: false },
        value: { type: "int", value: "3" }
      }]
    })).toBe(true);
  });

  it("rejects explicitly truncated unknown snapshots", () => {
    expect(isValueSnapshotComplete({
      type: "unknown",
      className: "Thing",
      repr: "<snapshot truncated>",
      truncated: true
    })).toBe(false);
  });
});
