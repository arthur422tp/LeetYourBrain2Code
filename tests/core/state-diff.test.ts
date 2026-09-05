import { describe, expect, it } from "vitest";

import type { FrameState } from "../../src/core/runtime-state";
import type {
  ListValueSnapshot,
  ValueSnapshot
} from "../../src/shared/trace-types";
import { diffFrameState } from "../../src/core/state-diff";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const string = (value: string): ValueSnapshot => ({
  type: "str",
  value,
  length: value.length,
  truncated: false
});

function frame(
  frameId: number,
  locals: Record<string, ValueSnapshot>
): FrameState {
  return {
    frameId,
    parentFrameId: null,
    functionName: "inspect",
    line: 1,
    locals
  };
}

function list(values: number[]): ListValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

function dict(entries: Array<[string, number]>): ValueSnapshot {
  return {
    type: "dict",
    length: entries.length,
    entries: entries.map(([key, value]) => ({ key: string(key), value: int(value) })),
    truncated: false
  };
}

function set(values: number[]): ValueSnapshot {
  return {
    type: "set",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

describe("diffFrameState", () => {
  it("does not report caller locals as removed when the frame changes", () => {
    const diff = diffFrameState(
      frame(1, { left: int(0), nums: list([1, 2]) }),
      frame(2, { right: int(1) })
    );

    expect(diff.frameId).toBe(2);
    expect(diff.variables).toEqual([
      { name: "right", kind: "added", after: int(1) }
    ]);
    expect(diff.containerChanges).toEqual([]);
  });

  it("reports added, removed, changed, and unchanged scalar variables in stable name order", () => {
    const diff = diffFrameState(
      frame(4, { addedLater: int(0), removed: int(2), same: int(3), changed: int(1) }),
      frame(4, { added: int(9), same: int(3), changed: int(7) })
    );

    expect(diff.variables).toEqual([
      { name: "added", kind: "added", after: int(9) },
      { name: "addedLater", kind: "removed", before: int(0) },
      { name: "changed", kind: "changed", before: int(1), after: int(7) },
      { name: "removed", kind: "removed", before: int(2) },
      { name: "same", kind: "unchanged", before: int(3), after: int(3) }
    ]);
  });

  it("reports list append, pop, and swap at index level", () => {
    const append = diffFrameState(frame(1, { values: list([1, 2]) }), frame(1, { values: list([1, 2, 3]) }));
    const pop = diffFrameState(frame(1, { values: list([1, 2, 3]) }), frame(1, { values: list([1, 2]) }));
    const swap = diffFrameState(frame(1, { values: list([1, 4, 3, 9]) }), frame(1, { values: list([1, 9, 3, 4]) }));

    expect(append.containerChanges).toEqual([
      {
        container: "values",
        kind: "list",
        changes: [{ index: 2, kind: "added", after: int(3) }]
      }
    ]);
    expect(pop.containerChanges).toEqual([
      {
        container: "values",
        kind: "list",
        changes: [{ index: 2, kind: "removed", before: int(3) }]
      }
    ]);
    expect(swap.containerChanges).toEqual([
      {
        container: "values",
        kind: "list",
        changes: [
          { index: 1, kind: "changed", before: int(4), after: int(9) },
          { index: 3, kind: "changed", before: int(9), after: int(4) }
        ]
      }
    ]);
  });

  it("reports dictionary insert, overwrite, and delete by canonical key", () => {
    const diff = diffFrameState(
      frame(1, { counts: dict([["keep", 1], ["overwrite", 2], ["delete", 3]]) }),
      frame(1, { counts: dict([["keep", 1], ["overwrite", 9], ["insert", 4]]) })
    );

    expect(diff.containerChanges).toEqual([
      {
        container: "counts",
        kind: "dict",
        changes: [
          { key: string("delete"), kind: "removed", before: int(3) },
          { key: string("insert"), kind: "added", after: int(4) },
          { key: string("overwrite"), kind: "changed", before: int(2), after: int(9) }
        ]
      }
    ]);
  });

  it("reports set members added and removed without depending on item order", () => {
    const diff = diffFrameState(
      frame(1, { visited: set([1, 2, 3]) }),
      frame(1, { visited: set([3, 4, 1]) })
    );

    expect(diff.containerChanges).toEqual([
      {
        container: "visited",
        kind: "set",
        changes: [
          { member: int(2), kind: "removed" },
          { member: int(4), kind: "added" }
        ]
      }
    ]);
  });

  it("treats a nested list replacement as one top-level index change", () => {
    const before: ListValueSnapshot = {
      type: "list",
      length: 2,
      items: [list([1, 2]), list([0, 0])],
      truncated: false
    };
    const after: ListValueSnapshot = {
      type: "list",
      length: 2,
      items: [list([1, 2]), list([3, 4])],
      truncated: false
    };
    const current: FrameState = frame(1, { matrix: after });

    const diff = diffFrameState(frame(1, { matrix: before }), current);

    expect(diff.containerChanges).toEqual([
      {
        container: "matrix",
        kind: "list",
        changes: [{ index: 1, kind: "changed", before: list([0, 0]), after: list([3, 4]) }]
      }
    ]);
  });
});
