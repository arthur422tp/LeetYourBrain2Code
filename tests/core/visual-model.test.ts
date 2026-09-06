import { describe, expect, it } from "vitest";

import type { FrameDiff } from "../../src/core/state-diff";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { SubscriptRelation } from "../../src/core/ast-relations";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { buildVisualState } from "../../src/core/visual-model";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function list(values: number[]): ValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

function dict(entries: Array<[number, number]>): ValueSnapshot {
  return {
    type: "dict",
    length: entries.length,
    entries: entries.map(([key, value]) => ({ key: int(key), value: int(value) })),
    truncated: false
  };
}

function runtime(locals: Record<string, ValueSnapshot>, exception?: RuntimeState["exception"]): RuntimeState {
  return {
    step: 12,
    activeFrameId: 4,
    frames: new Map([[
      4,
      {
        frameId: 4,
        parentFrameId: null,
        functionName: "twoSum",
        line: 7,
        locals
      }
    ]]),
    callStack: [4],
    currentLine: 7,
    stdout: "trace\n",
    ...(exception ? { exception } : {})
  };
}

const relation = (index: string): SubscriptRelation => ({
  scope: "Solution.twoSum",
  line: 7,
  container: "nums",
  index
});

const listDiff: FrameDiff = {
  frameId: 4,
  variables: [
    { name: "left", kind: "changed", before: int(0), after: int(1) },
    { name: "nums", kind: "changed", before: list([2, 7, 11, 15]), after: list([2, 9, 11, 15]) }
  ],
  containerChanges: [{
    container: "nums",
    kind: "list",
    changes: [{ index: 1, kind: "changed", before: int(7), after: int(9) }]
  }]
};

describe("buildVisualState", () => {
  it("builds a list visual with structural pointers and changed indexes", () => {
    const state = buildVisualState(
      runtime({ nums: list([2, 9, 11, 15]), left: int(1), right: int(3), target: int(20) }),
      listDiff,
      [relation("left"), relation("right")]
    );

    expect(state).toEqual({
      step: 12,
      currentLine: 7,
      primaryVisual: {
        kind: "list",
        variableName: "nums",
        items: [int(2), int(9), int(11), int(15)],
        pointers: [
          { name: "left", index: 1, outOfBounds: false },
          { name: "right", index: 3, outOfBounds: false }
        ],
        changedIndexes: [1]
      },
      containerVisuals: [{
        kind: "list",
        variableName: "nums",
        items: [int(2), int(9), int(11), int(15)],
        pointers: [
          { name: "left", index: 1, outOfBounds: false },
          { name: "right", index: 3, outOfBounds: false }
        ],
        changedIndexes: [1]
      }],
      stateChanges: listDiff,
      locals: { nums: list([2, 9, 11, 15]), left: int(1), right: int(3), target: int(20) },
      callStack: [{ frameId: 4, functionName: "twoSum", line: 7, depth: 1 }],
      stdout: "trace\n"
    });
  });

  it("materializes an out-of-bounds pointer without losing generic state", () => {
    const state = buildVisualState(
      runtime({ nums: list([2, 7]), left: int(5) }),
      null,
      [relation("left")]
    );

    expect(state.primaryVisual).toEqual({
      kind: "list",
      variableName: "nums",
      items: [int(2), int(7)],
      pointers: [{ name: "left", index: 5, outOfBounds: true }],
      changedIndexes: []
    });
    expect(state.locals).toEqual({ nums: list([2, 7]), left: int(5) });
    expect(state.stateChanges).toBeNull();
  });

  it("respects Python negative-index bounds when materializing pointers", () => {
    const state = buildVisualState(
      runtime({ nums: list([2, 7]), left: int(-1) }),
      null,
      [relation("left")]
    );

    expect(state.primaryVisual?.pointers).toEqual([
      { name: "left", index: -1, outOfBounds: false }
    ]);
  });

  it("keeps generic dictionary state when no specialized visual exists", () => {
    const exception = {
      type: "KeyError",
      message: "missing",
      line: 8,
      stack: [],
      frameId: 4
    };
    const mapping: ValueSnapshot = {
      type: "dict",
      length: 1,
      entries: [{ key: { type: "str", value: "x", length: 1, truncated: false }, value: int(1) }],
      truncated: false
    };

    const state = buildVisualState(
      runtime({ mapping }, exception),
      { frameId: 4, variables: [{ name: "mapping", kind: "unchanged", before: mapping, after: mapping }], containerChanges: [] },
      []
    );

    expect(state.primaryVisual).toBeNull();
    expect(state.locals).toEqual({ mapping });
    expect(state.stateChanges).toEqual({
      frameId: 4,
      variables: [{ name: "mapping", kind: "unchanged", before: mapping, after: mapping }],
      containerChanges: []
    });
    expect(state.exception).toEqual(exception);
    expect(state.callStack).toEqual([{ frameId: 4, functionName: "twoSum", line: 7, depth: 1 }]);
  });

  it("builds array and hash-map visuals for Two Sum without subscript relations", () => {
    const state = buildVisualState(
      runtime({
        nums: list([2, 7, 11, 15]),
        seen: dict([[2, 0]]),
        i: int(1),
        x: int(7),
        target: int(9)
      }),
      null,
      []
    );

    expect(state.primaryVisual).toBeNull();
    expect(state.containerVisuals).toEqual([
      {
        kind: "list",
        variableName: "nums",
        items: [int(2), int(7), int(11), int(15)],
        pointers: [],
        changedIndexes: []
      },
      {
        kind: "dict",
        variableName: "seen",
        entries: [{ key: int(2), value: int(0), status: "unchanged" }]
      }
    ]);
  });
});
