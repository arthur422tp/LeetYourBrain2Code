import { describe, expect, it } from "vitest";

import type { SubscriptRelation } from "../../src/core/ast-relations";
import type { TraceEvent, ValueSnapshot } from "../../src/shared/trace-types";
import { interpretTrace } from "../../src/core/trace-interpreter";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function list(values: number[]): ValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

function event(
  step: number,
  functionName: string,
  locals: Record<string, ValueSnapshot>,
  options: Partial<TraceEvent> = {}
): TraceEvent {
  return {
    step,
    event: "line",
    frameId: 4,
    parentFrameId: null,
    function: functionName,
    line: 7,
    callDepth: 1,
    locals,
    stdoutDelta: "",
    ...options
  };
}

function relation(container: string, index: string, scope = "Solution.solve"): SubscriptRelation {
  return { scope, line: 7, container, index };
}

describe("interpretTrace", () => {
  it("turns a two-pointer trace into a list visual and frame-scoped mutation diff", () => {
    const result = interpretTrace(
      [
        event(1, "solve", { nums: list([2, 7, 11, 15]), left: int(0), right: int(3) }),
        event(2, "solve", { nums: list([2, 9, 11, 15]), left: int(1), right: int(3) })
      ],
      [relation("nums", "left"), relation("nums", "right")]
    );

    expect(result.runtimeStates).toHaveLength(2);
    expect(result.frameDiffs[1]?.containerChanges).toEqual([{
      container: "nums",
      kind: "list",
      changes: [{ index: 1, kind: "changed", before: int(7), after: int(9) }]
    }]);
    expect(result.visualStates[1]?.primaryVisual).toEqual({
      kind: "list",
      variableName: "nums",
      items: [int(2), int(9), int(11), int(15)],
      pointers: [
        { name: "left", index: 1, outOfBounds: false },
        { name: "right", index: 3, outOfBounds: false }
      ],
      changedIndexes: [1]
    });
  });

  it("supports binary search and 1D DP index relations", () => {
    const binary = interpretTrace(
      [event(1, "search", { nums: list([1, 4, 8]), mid: int(1) }, { function: "search" })],
      [relation("nums", "mid", "Solution.search")]
    );
    const dp = interpretTrace(
      [
        event(1, "solve", { dp: list([0, 0, 0]), i: int(1) }),
        event(2, "solve", { dp: list([0, 5, 0]), i: int(1) })
      ],
      [relation("dp", "i")]
    );

    expect(binary.visualStates[0]?.primaryVisual?.pointers).toEqual([
      { name: "mid", index: 1, outOfBounds: false }
    ]);
    expect(dp.visualStates[1]?.primaryVisual).toEqual({
      kind: "list",
      variableName: "dp",
      items: [int(0), int(5), int(0)],
      pointers: [{ name: "i", index: 1, outOfBounds: false }],
      changedIndexes: [1]
    });
  });

  it("keeps 2D DP as generic nested locals instead of claiming a matrix renderer", () => {
    const matrix: ValueSnapshot = {
      type: "list",
      length: 2,
      items: [list([0, 1]), list([1, 2])],
      truncated: false
    };

    const result = interpretTrace(
      [event(1, "solve", { matrix })],
      []
    );

    expect(result.visualStates[0]?.primaryVisual).toBeNull();
    expect(result.visualStates[0]?.locals).toEqual({ matrix });
  });

  it("keeps hash-map and graph state generic while preserving structural locals", () => {
    const mapping: ValueSnapshot = {
      type: "dict",
      length: 1,
      entries: [{ key: { type: "str", value: "a", length: 1, truncated: false }, value: int(1) }],
      truncated: false
    };
    const graph: ValueSnapshot = {
      type: "dict",
      length: 1,
      entries: [{ key: int(0), value: list([1, 2]) }],
      truncated: false
    };

    const hashMap = interpretTrace([event(1, "solve", { mapping })], []);
    const graphState = interpretTrace([event(1, "solve", {
      graph,
      queue: list([0]),
      visited: { type: "set", length: 1, items: [int(0)], truncated: false },
      current: int(0)
    })], []);

    expect(hashMap.visualStates[0]?.primaryVisual).toBeNull();
    expect(hashMap.visualStates[0]?.locals).toEqual({ mapping });
    expect(graphState.visualStates[0]?.primaryVisual).toBeNull();
    expect(graphState.visualStates[0]?.locals).toEqual({
      graph,
      queue: list([0]),
      visited: { type: "set", length: 1, items: [int(0)], truncated: false },
      current: int(0)
    });
  });

  it("preserves recursive DFS call-stack frame identity across interpreted states", () => {
    const result = interpretTrace([
      event(1, "dfs", { node: int(3) }, { event: "call", frameId: 1, line: 1 }),
      event(2, "dfs", { node: int(2) }, { event: "call", frameId: 2, parentFrameId: 1, callDepth: 2, line: 1 }),
      event(3, "dfs", { node: int(2), child: int(1) }, { frameId: 2, parentFrameId: 1, callDepth: 2 })
    ], []);

    expect(result.visualStates[1]?.callStack).toEqual([
      { frameId: 1, functionName: "dfs", line: 1, depth: 1 },
      { frameId: 2, functionName: "dfs", line: 1, depth: 2 }
    ]);
    expect(result.visualStates[2]?.locals).toEqual({ node: int(2), child: int(1) });
  });
});
