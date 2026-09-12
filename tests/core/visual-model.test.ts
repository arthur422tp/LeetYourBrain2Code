import { describe, expect, it } from "vitest";

import type { FrameDiff } from "../../src/core/state-diff";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { SubscriptRelation } from "../../src/core/ast-relations";
import type { MatrixSubscriptRelation, ObjectSnapshot, ValueSnapshot } from "../../src/shared/trace-types";
import type { RuntimeMutation } from "../../src/core/runtime-mutation";
import { buildVisualState } from "../../src/core/visual-model";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const ref = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "ListNode"
});
const treeRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "TreeNode"
});
const graphRef = (objectId: string): ValueSnapshot => ({
  type: "reference",
  objectId,
  className: "Node"
});

function list(values: number[]): ValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

function matrix(values: number[][]): ValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map((rowValues) => ({
      type: "list",
      length: rowValues.length,
      items: rowValues.map(int),
      truncated: false
    })),
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
    objectTopology: { objects: new Map(), truncated: false },
    ...(exception ? { exception } : {})
  };
}

function treeRuntime(extraLocals: Record<string, ValueSnapshot> = {}): RuntimeState {
  return {
    ...runtime({ root: treeRef("tree-1"), ...extraLocals }),
    objectTopology: {
      objects: new Map([["tree-1", {
        objectId: "tree-1",
        className: "TreeNode",
        attributes: {
          val: int(1),
          left: { type: "none", value: null },
          right: { type: "none", value: null }
        }
      }]]),
      truncated: false
    }
  };
}

function graphNodeObject(
  objectId: string,
  value: number,
  neighbors: string[]
): ObjectSnapshot {
  return {
    objectId,
    className: "Node",
    attributes: {
      val: int(value),
      neighbors: {
        type: "list",
        length: neighbors.length,
        items: neighbors.map(graphRef),
        truncated: false
      }
    }
  };
}

function graphRuntime(extraLocals: Record<string, ValueSnapshot> = {}): RuntimeState {
  return {
    ...runtime({ root: graphRef("graph-1"), ...extraLocals }),
    objectTopology: {
      objects: new Map([
        ["graph-1", graphNodeObject("graph-1", 1, ["graph-2"])],
        ["graph-2", graphNodeObject("graph-2", 2, [])]
      ]),
      truncated: false
    }
  };
}

const relation = (index: string): SubscriptRelation => ({
  scope: "Solution.twoSum",
  line: 7,
  container: "nums",
  index
});

const matrixRelation = (line = 7): MatrixSubscriptRelation => ({
  kind: "matrix_subscript",
  scope: "Solution.twoSum",
  line,
  container: "dp",
  rowIndex: { kind: "variable", name: "i" },
  columnIndex: { kind: "variable", name: "j" }
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

const listMutations: RuntimeMutation[] = [{
  kind: "sequence_element",
  origin: "transition",
  frameId: 4,
  containerName: "nums",
  containerKind: "list",
  index: 1,
  action: "changed",
  before: int(7),
  after: int(9)
}];

describe("buildVisualState", () => {
  it("gives a valid Matrix exclusive ownership of its variable and ranks it above a list", () => {
    const state = buildVisualState(
      runtime({
        dp: matrix([[0, 0], [0, 0]]),
        nums: list([4, 2, 7]),
        i: int(1),
        j: int(0)
      }),
      null,
      [matrixRelation()]
    );

    expect(state.visuals.map((visual) => visual.visualId)).toEqual(
      expect.arrayContaining(["matrix:dp", "list:nums"])
    );
    expect(state.visuals.map((visual) => visual.visualId)).not.toContain("list:dp");
    expect(state.primaryVisualId).toBe("matrix:dp");
  });

  it("keeps unsupported ragged matrices out of both Matrix and nested-list visuals", () => {
    const state = buildVisualState(
      runtime({
        dp: {
          type: "list",
          length: 2,
          items: [
            { type: "list", length: 2, items: [int(0), int(0)], truncated: false },
            { type: "list", length: 1, items: [int(0)], truncated: false }
          ],
          truncated: false
        },
        nums: list([4, 2, 7])
      }),
      null,
      [matrixRelation()]
    );

    expect(state.visuals.map((visual) => visual.visualId)).not.toEqual(
      expect.arrayContaining(["matrix:dp", "list:dp"])
    );
  });

  it("ranks a changed Matrix even when there is no current-line focus", () => {
    const state = buildVisualState(
      runtime({
        dp: matrix([[0, 0], [7, 0]]),
        nums: list([4, 2, 7])
      }),
      null,
      [],
      null,
      [{
        kind: "sequence_element",
        origin: "transition",
        frameId: 4,
        containerName: "dp",
        containerKind: "list",
        index: 1,
        action: "changed",
        before: {
          type: "list",
          length: 2,
          items: [int(0), int(0)],
          truncated: false
        },
        after: {
          type: "list",
          length: 2,
          items: [int(7), int(0)],
          truncated: false
        }
      }]
    );

    expect(state.visuals.find((visual) => visual.visualId === "matrix:dp")).toMatchObject({
      changedCells: [{ row: 1, column: 0, action: "changed" }]
    });
    expect(state.primaryVisualId).toBe("matrix:dp");
  });

  it("highlights list indexes from sequence mutations without a frame diff", () => {
    const mutations: RuntimeMutation[] = [{
      kind: "sequence_element",
      origin: "transition",
      frameId: 4,
      containerName: "nums",
      containerKind: "list",
      index: 1,
      action: "changed",
      before: int(7),
      after: int(9)
    }];

    const state = buildVisualState(
      runtime({ nums: list([2, 9, 11]), left: int(1) }),
      null,
      [relation("left")],
      null,
      mutations
    );
    const visual = state.visuals.find((item) => item.visualId === "list:nums");

    expect(visual).toMatchObject({ changedIndexes: [1] });
  });

  it("marks dictionary entries from mapping mutations without a frame diff", () => {
    const mutations: RuntimeMutation[] = [
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 4,
        containerName: "seen",
        key: int(1),
        action: "added",
        after: int(10)
      },
      {
        kind: "mapping_entry",
        origin: "transition",
        frameId: 4,
        containerName: "seen",
        key: int(2),
        action: "changed",
        before: int(3),
        after: int(4)
      }
    ];

    const state = buildVisualState(
      runtime({ seen: dict([[1, 10], [2, 4]]) }),
      null,
      [],
      null,
      mutations
    );

    expect(state.visuals.find((item) => item.visualId === "dict:seen")).toMatchObject({
      entries: [
        { key: int(1), value: int(10), status: "added" },
        { key: int(2), value: int(4), status: "changed" }
      ]
    });
  });

  it("prioritizes a dictionary receiving a mapping mutation over a pointer-relevant list", () => {
    const state = buildVisualState(
      runtime({ nums: list([1, 2, 3]), seen: dict([[1, 10]]), i: int(1) }),
      null,
      [{ ...relation("i"), line: 99 }],
      null,
      [{
        kind: "mapping_entry",
        origin: "transition",
        frameId: 4,
        containerName: "seen",
        key: int(2),
        action: "added",
        after: int(11)
      }]
    );

    expect(state.primaryVisualId).toBe("dict:seen");
  });

  it("prioritizes a linked list receiving a pointer mutation over a pointer-richer list", () => {
    const head = ref("obj-1");
    const linkedRuntime: RuntimeState = {
      ...runtime({ nums: list([1, 2, 3]), i: int(0), j: int(2), head }),
      objectTopology: {
        objects: new Map([
          ["obj-1", {
            objectId: "obj-1",
            className: "ListNode",
            attributes: {
              val: int(1),
              next: { type: "none", value: null }
            }
          }]
        ]),
        truncated: false
      }
    };

    const state = buildVisualState(
      linkedRuntime,
      null,
      [{ ...relation("i"), line: 99 }, { ...relation("j"), line: 99 }],
      null,
      [{
        kind: "reference",
        origin: "transition",
        owner: { scope: "local", frameId: 4, variableName: "head" },
        action: "redirected",
        beforeObjectId: "obj-0",
        afterObjectId: "obj-1"
      }]
    );

    expect(state.primaryVisualId).toBe("linked_list:obj-1");
  });

  it("builds a list visual with structural pointers and changed indexes", () => {
    const state = buildVisualState(
      runtime({ nums: list([2, 9, 11, 15]), left: int(1), right: int(3), target: int(20) }),
      listDiff,
      [relation("left"), relation("right")],
      null,
      listMutations
    );

    expect(state).toEqual({
      step: 12,
      currentLine: 7,
      visuals: [{
        kind: "list",
        visualId: "list:nums",
        variableName: "nums",
        items: [int(2), int(9), int(11), int(15)],
        pointers: [
          { name: "left", index: 1, outOfBounds: false },
          { name: "right", index: 3, outOfBounds: false }
        ],
        changedIndexes: [1]
      }],
      primaryVisualId: "list:nums",
      objectChanges: null,
      stateChanges: listDiff,
      mutations: listMutations,
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

    expect(state.visuals.find((visual) => visual.visualId === "list:nums")).toEqual({
      kind: "list",
      visualId: "list:nums",
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

    expect(state.visuals.find((visual) => visual.visualId === "list:nums")).toEqual(expect.objectContaining({
      pointers: [
        { name: "left", index: -1, outOfBounds: false }
      ]
    }));
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

    expect(state.visuals).toContainEqual({
      kind: "dict",
      visualId: "dict:mapping",
      variableName: "mapping",
      entries: [{ key: { type: "str", value: "x", length: 1, truncated: false }, value: int(1), status: "unchanged" }]
    });
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

    expect(state.visuals).toEqual([
      {
        kind: "dict",
        visualId: "dict:seen",
        variableName: "seen",
        entries: [{ key: int(2), value: int(0), status: "unchanged" }]
      },
      {
        kind: "list",
        visualId: "list:nums",
        variableName: "nums",
        items: [int(2), int(7), int(11), int(15)],
        pointers: [],
        changedIndexes: []
      }
    ]);
  });

  it("shows a dictionary membership probe on its active source line", () => {
    const membershipRelation = {
      kind: "membership",
      scope: "Solution.twoSum",
      line: 7,
      container: "seen",
      index: "need"
    } as unknown as SubscriptRelation;
    const seen = dict([[2, 0]]);

    const state = buildVisualState(
      runtime({ seen, need: int(2) }),
      null,
      [membershipRelation]
    );

    expect(state.visuals).toContainEqual({
      kind: "dict",
      visualId: "dict:seen",
      variableName: "seen",
      entries: [{ key: int(2), value: int(0), status: "unchanged" }],
      probes: [{
        keyVariable: "need",
        key: int(2),
        status: "hit",
        operation: "membership"
      }]
    });
  });

  it("exposes structure-neutral visuals and a primary visual id", () => {
    const state = buildVisualState(
      runtime({ nums: list([2, 9, 11, 15]), left: int(1), right: int(3) }),
      listDiff,
      [relation("left"), relation("right")]
    );

    expect(state.visuals.map((visual) => visual.visualId)).toEqual(["list:nums"]);
    expect(state.primaryVisualId).toBe("list:nums");
    expect(state.objectChanges).toBeNull();
  });

  it("caps the visible visual models at three candidates", () => {
    const state = buildVisualState(
      runtime({
        first: list([1]),
        second: list([2]),
        third: dict([[3, 3]]),
        fourth: dict([[4, 4]])
      }),
      null,
      []
    );

    expect(state.visuals).toHaveLength(3);
    expect(new Set(state.visuals.map((visual) => visual.visualId)).size).toBe(3);
  });

  it("builds Tree through the existing visual state path", () => {
    const state = buildVisualState(treeRuntime(), null, [], null, []);
    expect(state.visuals.find((visual) => visual.kind === "tree")).toMatchObject({
      kind: "tree",
      visualId: "tree:TreeNode"
    });
    expect(state.primaryVisualId).toBe("tree:TreeNode");
  });

  it("prioritizes a mutated Tree over a pointer-relevant non-mutated list", () => {
    const state = buildVisualState(
      treeRuntime({ nums: list([1, 2, 3]), i: int(1) }),
      null,
      [{ ...relation("i"), line: 99 }],
      null,
      [{
        kind: "object_attribute",
        origin: "transition",
        objectId: "tree-1",
        attribute: "val",
        action: "changed",
        before: int(0),
        after: int(1)
      }]
    );
    expect(state.primaryVisualId).toBe("tree:TreeNode");
  });

  it("does not hard-code Tree primary over a mutated dict", () => {
    const state = buildVisualState(
      treeRuntime({ seen: dict([[1, 10]]) }),
      null,
      [],
      null,
      [{
        kind: "mapping_entry",
        origin: "transition",
        frameId: 4,
        containerName: "seen",
        key: int(2),
        action: "added",
        after: int(11)
      }]
    );
    expect(state.primaryVisualId).toBe("dict:seen");
  });

  it("builds Graph through the visual state path", () => {
    const state = buildVisualState(graphRuntime(), null, [], null, []);

    expect(state.visuals.find((visual) => visual.kind === "graph")).toMatchObject({
      kind: "graph",
      visualId: "graph:Node"
    });
    expect(state.primaryVisualId).toBe("graph:Node");
  });

  it("prioritizes a mutated Graph over a pointer-relevant list", () => {
    const state = buildVisualState(
      graphRuntime({ nums: list([1, 2, 3]), i: int(1) }),
      null,
      [{ ...relation("i"), line: 99 }],
      null,
      [{
        kind: "object_attribute",
        origin: "transition",
        objectId: "graph-1",
        attribute: "neighbors",
        action: "changed",
        before: {
          type: "list",
          length: 1,
          items: [graphRef("graph-2")],
          truncated: false
        },
        after: {
          type: "list",
          length: 0,
          items: [],
          truncated: false
        }
      }]
    );

    expect(state.primaryVisualId).toBe("graph:Node");
  });

  it("does not hard-code Graph primary over a higher-priority existing candidate", () => {
    const state = buildVisualState(
      graphRuntime({ seen: dict([[1, 10]]) }),
      null,
      [],
      null,
      [{
        kind: "mapping_entry",
        origin: "transition",
        frameId: 4,
        containerName: "seen",
        key: int(2),
        action: "added",
        after: int(11)
      }]
    );

    expect(state.primaryVisualId).toBe("dict:seen");
  });
});
