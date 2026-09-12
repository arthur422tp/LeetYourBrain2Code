import { describe, expect, it } from "vitest";

import type { RuntimeState } from "../../src/core/runtime-state";
import type { SubscriptRelation } from "../../src/core/ast-relations";
import type { ValueSnapshot } from "../../src/shared/trace-types";
import { resolvePointerBindings } from "../../src/core/binding-resolver";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

const numbers: ValueSnapshot = {
  type: "list",
  length: 4,
  items: [int(2), int(7), int(11), int(15)],
  truncated: false
};

function relation(index: string, line = 7, scope = "Solution.twoSum"): SubscriptRelation {
  return { scope, line, container: "nums", index };
}

function state(locals: Record<string, ValueSnapshot>): RuntimeState {
  return {
    step: 10,
    activeFrameId: 4,
    frames: new Map([
      [4, {
        frameId: 4,
        parentFrameId: null,
        functionName: "twoSum",
        line: 7,
        locals
      }]
    ]),
    callStack: [4],
    currentLine: 7,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

describe("resolvePointerBindings", () => {
  it("binds every structurally used integer index in the active frame", () => {
    expect(resolvePointerBindings(
      [relation("left"), relation("right")],
      state({ nums: numbers, left: int(0), right: int(3), target: int(9) })
    )).toEqual([
      { frameId: 4, variable: "left", container: "nums", index: 0, source: "subscript", confidence: 1 },
      { frameId: 4, variable: "right", container: "nums", index: 3, source: "subscript", confidence: 1 }
    ]);
  });

  it("does not infer a pointer from a variable that never appears as a subscript index", () => {
    expect(resolvePointerBindings(
      [relation("left")],
      state({ nums: numbers, left: int(0), target: int(3) })
    )).toEqual([
      { frameId: 4, variable: "left", container: "nums", index: 0, source: "subscript", confidence: 1 }
    ]);
  });

  it("keeps an out-of-bounds integer index so the renderer can explain the failed access", () => {
    expect(resolvePointerBindings(
      [relation("left")],
      state({ nums: numbers, left: int(5) })
    )).toEqual([
      { frameId: 4, variable: "left", container: "nums", index: 5, source: "subscript", confidence: 1 }
    ]);
  });

  it("rejects relations from another lexical function scope", () => {
    expect(resolvePointerBindings(
      [relation("left", 7, "Solution.other")],
      state({ nums: numbers, left: int(0) })
    )).toEqual([]);
  });

  it("requires an existing list or tuple and an integer runtime index", () => {
    const tuple: ValueSnapshot = {
      type: "tuple",
      length: 2,
      items: [int(1), int(2)],
      truncated: false
    };

    expect(resolvePointerBindings(
      [
        { scope: "Solution.twoSum", line: 7, container: "nums", index: "missing" },
        { scope: "Solution.twoSum", line: 7, container: "mapping", index: "left" },
        { scope: "Solution.twoSum", line: 7, container: "nums", index: "fraction" },
        { scope: "Solution.twoSum", line: 7, container: "tupleValue", index: "left" }
      ],
      state({
        nums: numbers,
        mapping: { type: "dict", length: 0, entries: [], truncated: false },
        fraction: { type: "float", value: 1.5 },
        tupleValue: tuple,
        left: int(1)
      })
    )).toEqual([
      { frameId: 4, variable: "left", container: "tupleValue", index: 1, source: "subscript", confidence: 1 }
    ]);
  });

  it("binds an enumerate cursor to the iterated list and preserves its value variable", () => {
    const enumerateRelation = {
      kind: "iteration",
      scope: "Solution.twoSum",
      line: 4,
      container: "nums",
      index: "i",
      value: "x"
    } as unknown as SubscriptRelation;

    expect(resolvePointerBindings(
      [enumerateRelation],
      state({ nums: numbers, i: int(1), x: int(7) })
    )).toEqual([
      {
        frameId: 4,
        variable: "i",
        container: "nums",
        index: 1,
        source: "iteration",
        valueVariable: "x",
        confidence: 1
      }
    ]);
  });

  it("ignores matrix relations instead of treating a legacy index field as a 1D binding", () => {
    const matrixRelation = {
      kind: "matrix_subscript",
      scope: "Solution.twoSum",
      line: 7,
      container: "nums",
      rowIndex: { kind: "variable", name: "row" },
      columnIndex: { kind: "variable", name: "column" },
      index: "row"
    } as unknown as SubscriptRelation;

    expect(resolvePointerBindings(
      [matrixRelation],
      state({ nums: numbers, row: int(1), column: int(2) })
    )).toEqual([]);
  });
});
