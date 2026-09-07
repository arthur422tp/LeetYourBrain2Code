import { describe, expect, it } from "vitest";

import type { PointerBinding } from "../../src/core/binding-resolver";
import type { FrameDiff } from "../../src/core/state-diff";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import type { SubscriptRelation } from "../../src/core/ast-relations";
import { selectPrimaryContainers } from "../../src/core/primary-container-resolver";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function list(values: number[]): ValueSnapshot {
  return {
    type: "list",
    length: values.length,
    items: values.map(int),
    truncated: false
  };
}

function state(locals: Record<string, ValueSnapshot>): RuntimeState {
  return {
    step: 5,
    activeFrameId: 2,
    frames: new Map([[
      2,
      {
        frameId: 2,
        parentFrameId: null,
        functionName: "solve",
        line: 8,
        locals
      }
    ]]),
    callStack: [2],
    currentLine: 8,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

const binding = (container: string, variable = "i"): PointerBinding => ({
  frameId: 2,
  variable,
  container,
  index: 1,
  source: "subscript",
  confidence: 1
});

describe("selectPrimaryContainers", () => {
  it("prefers a bound active container over a different changed container", () => {
    const diff: FrameDiff = {
      frameId: 2,
      variables: [],
      containerChanges: [{
        container: "prefix",
        kind: "list",
        changes: [{ index: 0, kind: "changed", before: int(0), after: int(1) }]
      }]
    };

    expect(selectPrimaryContainers(
      state({ nums: list([1, 2]), prefix: list([1, 0]), target: int(9) }),
      [binding("nums")],
      diff
    )).toEqual({ primary: "nums", secondary: ["prefix"] });
  });

  it("prefers the binding referenced on the current source line", () => {
    const relations: SubscriptRelation[] = [
      { scope: "solve", line: 12, container: "nums", index: "left" },
      { scope: "solve", line: 8, container: "prefix", index: "i" }
    ];

    expect(selectPrimaryContainers(
      state({ nums: list([1, 2]), prefix: list([1, 0]) }),
      [binding("nums", "left"), binding("prefix")],
      { frameId: 2, variables: [], containerChanges: [] },
      relations
    )).toEqual({ primary: "prefix", secondary: ["nums"] });
  });

  it("prefers the changed container when no pointer binding exists", () => {
    const diff: FrameDiff = {
      frameId: 2,
      variables: [],
      containerChanges: [{
        container: "dp",
        kind: "list",
        changes: [{ index: 1, kind: "added", after: int(3) }]
      }]
    };

    expect(selectPrimaryContainers(
      state({ nums: list([1, 2]), dp: list([0, 3]), prefix: list([1]) }),
      [],
      diff
    )).toEqual({ primary: "dp", secondary: ["nums", "prefix"] });
  });

  it("keeps generic containers available but does not heuristically choose a primary", () => {
    expect(selectPrimaryContainers(
      state({ nums: list([1, 2]), prefix: list([1]), target: int(9) }),
      [],
      { frameId: 2, variables: [], containerChanges: [] }
    )).toEqual({ primary: null, secondary: ["nums", "prefix"] });
  });

  it("does not select containers from an inactive frame", () => {
    const inactive = state({ nums: list([1, 2]) });
    inactive.activeFrameId = null;

    expect(selectPrimaryContainers(inactive, [binding("nums")], {
      frameId: 2,
      variables: [],
      containerChanges: []
    })).toEqual({ primary: null, secondary: [] });
  });
});
