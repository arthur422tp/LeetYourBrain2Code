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

function objectNode(
  objectId: string,
  nextObjectId: string | null
): NonNullable<TraceEvent["objects"]>[number] {
  return {
    objectId,
    className: "ListNode",
    attributes: {
      val: int(Number(objectId.slice(-1))),
      next: nextObjectId === null
        ? { type: "none", value: null }
        : { type: "reference", objectId: nextObjectId, className: "ListNode" }
    }
  };
}

function relation(container: string, index: string, scope = "Solution.solve"): SubscriptRelation {
  return { scope, line: 7, container, index };
}

describe("interpretTrace", () => {
  it("aligns one mutation batch with every reconstructed runtime state", () => {
    const result = interpretTrace([
      event(1, "solve", { left: int(0) }),
      event(2, "solve", { left: int(1) })
    ]);

    expect(result.runtimeStates.length).toBe(result.frameDiffs.length);
    expect(result.runtimeStates.length).toBe(result.objectDiffs.length);
    expect(result.mutationBatches).toHaveLength(result.runtimeStates.length);
    expect(result.runtimeStates.length).toBe(result.visualStates.length);
    expect(result.behavioralAnalysis).toEqual(expect.objectContaining({
      patterns: expect.any(Array),
      stepAnnotations: expect.any(Array)
    }));
    expect(result.mutationBatches.map((batch) => batch.step)).toEqual([1, 2]);
    expect(result.mutationBatches[0]?.mutations[0]).toMatchObject({
      kind: "variable",
      origin: "initial_snapshot",
      variableName: "left"
    });
    expect(result.mutationBatches[1]?.mutations).toEqual([
      expect.objectContaining({
        kind: "variable",
        origin: "transition",
        variableName: "left",
        action: "changed"
      })
    ]);
    expect(result.visualStates[1]?.mutations).toEqual(result.mutationBatches[1]?.mutations);
  });

  it("does not share mutation snapshots between batches and visual state", () => {
    const result = interpretTrace([
      event(1, "solve", { left: int(0) }),
      event(2, "solve", { left: int(1) })
    ]);
    const batchMutation = result.mutationBatches[1]!.mutations[0]!;
    const visualMutation = result.visualStates[1]!.mutations[0]!;

    expect(visualMutation).toEqual(batchMutation);
    expect(visualMutation).not.toBe(batchMutation);
    if (batchMutation.kind === "variable" && batchMutation.after?.type === "int") {
      batchMutation.after.value = "mutated";
    }
    expect(visualMutation).toMatchObject({
      kind: "variable",
      after: { type: "int", value: "1" }
    });
  });

  it("reports repeated state and no progress for an exact repeated anchor", () => {
    const result = interpretTrace([
      event(1, "solve", { left: int(2) }),
      event(2, "solve", { left: int(2) }),
      event(3, "solve", { left: int(2) })
    ]);

    expect(result.behavioralAnalysis.patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "repeated_state", repeatCount: 3 }),
      expect.objectContaining({ kind: "no_progress", revisitCount: 2 })
    ]));
    expect(result.behavioralAnalysis.patterns.map((pattern) => pattern.kind as string))
      .not.toContain("infinite_loop");
  });

  it("reports a finite changing transition motif without no-progress evidence", () => {
    const result = interpretTrace([
      event(1, "solve", { i: int(0) }),
      event(2, "solve", { i: int(1) }),
      event(3, "solve", { i: int(2) }),
      event(4, "solve", { i: int(3) })
    ]);

    expect(result.behavioralAnalysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 1,
      repeatCount: 3
    }));
    expect(result.behavioralAnalysis.patterns.filter((pattern) => pattern.kind === "no_progress")).toEqual([]);
  });

  it("does not claim exact repeated state from truncated topology", () => {
    const result = interpretTrace([
      event(1, "solve", { i: int(0) }, { objectsTruncated: true }),
      event(2, "solve", { i: int(1) }, { objectsTruncated: true }),
      event(3, "solve", { i: int(2) }, { objectsTruncated: true }),
      event(4, "solve", { i: int(3) }, { objectsTruncated: true })
    ]);

    expect(result.behavioralAnalysis.patterns.filter((pattern) =>
      pattern.kind === "repeated_state" || pattern.kind === "no_progress"
    )).toEqual([]);
    expect(result.behavioralAnalysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_transition"
    }));
  });

  it("keeps behavioral evidence before a runtime exception", () => {
    const result = interpretTrace([
      event(1, "solve", { left: int(2) }),
      event(2, "solve", { left: int(2) }),
      event(3, "solve", { left: int(2) }),
      event(4, "solve", { left: int(2) }, {
        event: "exception",
        line: 8,
        eventPayload: {
          type: "exception",
          exception: {
            type: "RuntimeError",
            message: "boom",
            line: 8,
            stack: [],
            frameId: 4
          }
        }
      })
    ]);

    expect(result.behavioralAnalysis.patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "repeated_state" }),
      expect.objectContaining({ kind: "no_progress" })
    ]));
    expect(result.runtimeStates.at(-1)?.exception).toEqual(expect.objectContaining({
      type: "RuntimeError",
      message: "boom"
    }));
  });

  it("tracks initial snapshot origin independently for each frame", () => {
    const result = interpretTrace([
      event(1, "dfs", { node: int(3) }, { frameId: 1, event: "call", line: 1 }),
      event(2, "dfs", { node: int(2) }, {
        frameId: 2,
        parentFrameId: 1,
        callDepth: 2,
        event: "call",
        line: 1
      }),
      event(3, "dfs", { node: int(2), child: int(1) }, {
        frameId: 2,
        parentFrameId: 1,
        callDepth: 2
      })
    ]);

    expect(result.mutationBatches[0]?.mutations.every((mutation) =>
      mutation.origin === "initial_snapshot"
    )).toBe(true);
    expect(result.mutationBatches[1]?.mutations.every((mutation) =>
      mutation.origin === "initial_snapshot"
    )).toBe(true);
    expect(result.mutationBatches[2]?.mutations).toContainEqual(
      expect.objectContaining({
        origin: "transition",
        kind: "variable",
        variableName: "child"
      })
    );
  });

  it("marks object visibility from the first capture as initial and later captures as transition", () => {
    const result = interpretTrace([
      event(1, "reverseList", { head: { type: "none", value: null } }, {
        objects: [objectNode("obj-1", "obj-2"), objectNode("obj-2", null)]
      }),
      event(2, "reverseList", { head: { type: "none", value: null } }, {
        objects: [objectNode("obj-2", null), objectNode("obj-3", null)]
      })
    ]);

    expect(result.mutationBatches[0]?.mutations).toContainEqual({
      kind: "object_visibility",
      origin: "initial_snapshot",
      objectId: "obj-1",
      action: "appeared"
    });
    expect(result.mutationBatches[1]?.mutations).toContainEqual({
      kind: "object_visibility",
      origin: "transition",
      objectId: "obj-1",
      action: "disappeared"
    });
    expect(result.mutationBatches[1]?.mutations).toContainEqual({
      kind: "object_visibility",
      origin: "transition",
      objectId: "obj-3",
      action: "appeared"
    });
  });

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
    expect(result.visualStates[1]?.visuals.find((visual) => visual.visualId === "list:nums")).toEqual({
      kind: "list",
      visualId: "list:nums",
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

    expect(binary.visualStates[0]?.visuals.find((visual) => visual.visualId === "list:nums")).toEqual(expect.objectContaining({
      pointers: [
        { name: "mid", index: 1, outOfBounds: false }
      ]
    }));
    expect(dp.visualStates[1]?.visuals.find((visual) => visual.visualId === "list:dp")).toEqual({
      kind: "list",
      visualId: "list:dp",
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

    expect(result.visualStates[0]?.visuals).toEqual([]);
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

    expect(hashMap.visualStates[0]?.visuals).toContainEqual({
      kind: "dict",
      visualId: "dict:mapping",
      variableName: "mapping",
      entries: [{ key: { type: "str", value: "a", length: 1, truncated: false }, value: int(1), status: "unchanged" }]
    });
    expect(hashMap.visualStates[0]?.locals).toEqual({ mapping });
    expect(graphState.visualStates[0]?.visuals).toEqual([
      {
        kind: "dict",
        visualId: "dict:graph",
        variableName: "graph",
        entries: [{ key: int(0), value: list([1, 2]), status: "unchanged" }]
      },
      {
        kind: "list",
        visualId: "list:queue",
        variableName: "queue",
        items: [int(0)],
        pointers: [],
        changedIndexes: []
      }
    ]);
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

  it("exposes topology diffs aligned with reconstructed runtime states", () => {
    const result = interpretTrace([
      event(1, "reverseList", {
        head: { type: "reference", objectId: "obj-1", className: "ListNode" }
      }, {
        objects: [objectNode("obj-1", "obj-2"), objectNode("obj-2", null)]
      }),
      event(2, "reverseList", {
        head: { type: "reference", objectId: "obj-1", className: "ListNode" }
      }, {
        objects: [objectNode("obj-1", null), objectNode("obj-2", null)]
      })
    ]);

    expect(result.objectDiffs[1]?.attributeChanges).toEqual([
      expect.objectContaining({ objectId: "obj-1", attribute: "next", kind: "changed" })
    ]);
    expect(result.visualStates[1]?.objectChanges).toEqual(result.objectDiffs[1]);
  });

  it("keeps a partially reversed chain finite while exposing the changed edges", () => {
    const reference = (objectId: string): ValueSnapshot => ({
      type: "reference",
      objectId,
      className: "ListNode"
    });
    const result = interpretTrace([
      event(1, "reverseList", {
        prev: { type: "none", value: null },
        curr: reference("obj-1")
      }, {
        objects: [objectNode("obj-1", "obj-2"), objectNode("obj-2", "obj-3"), objectNode("obj-3", null)]
      }),
      event(2, "reverseList", {
        prev: { type: "none", value: null },
        curr: reference("obj-1")
      }, {
        objects: [objectNode("obj-1", null), objectNode("obj-2", "obj-3"), objectNode("obj-3", null)]
      })
    ]);

    const visual = result.visualStates[1]?.visuals.find((item) => item.kind === "linked_list");
    expect(visual).toMatchObject({
      kind: "linked_list",
      visualId: "linked_list:obj-1",
      cyclic: false,
      truncated: false,
      components: [{
        componentId: "component:obj-1",
        nodeIds: ["obj-1"],
        entryNodeIds: ["obj-1"]
      }, {
        componentId: "component:obj-2",
        nodeIds: ["obj-2", "obj-3"],
        entryNodeIds: ["obj-2"]
      }]
    });
    expect(visual?.nodes.map((node) => [node.objectId, node.nextObjectId])).toEqual([
      ["obj-1", null],
      ["obj-2", "obj-3"],
      ["obj-3", null]
    ]);
    expect(visual?.pointers).toEqual([
      { variableName: "curr", objectId: "obj-1", status: "unchanged" }
    ]);
  });
});
