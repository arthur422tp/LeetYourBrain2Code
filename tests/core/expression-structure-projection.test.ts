import { describe, expect, it } from "vitest";

import { projectStructureReferences } from "../../src/core/expression-structure-projection";
import type { RuntimeState } from "../../src/core/runtime-state";
import type {
  ExpressionPlan,
  ExpressionRootDescriptor,
  ExpressionRootEvaluation
} from "../../src/shared/expression-types";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

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
    items: values.map((row) => list(row)),
    truncated: false
  };
}

function runtime(locals: Record<string, ValueSnapshot>): RuntimeState {
  return {
    step: 7,
    activeFrameId: 4,
    frames: new Map([[
      4,
      { frameId: 4, parentFrameId: null, functionName: "solve", line: 7, locals }
    ]]),
    callStack: [4],
    currentLine: 7,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

const span = { line: 7, column: 0, endLine: 7, endColumn: 1 };

const plan: ExpressionPlan = {
  version: 1,
  roots: [
    {
      rootId: "r-list",
      kind: "assignment",
      expressionExprId: "r-list.0",
      target: { source: "x", span },
      span
    },
    {
      rootId: "r-matrix",
      kind: "assignment",
      expressionExprId: "r-matrix.0",
      target: {
        source: "dp[i][j]",
        span,
        structureHint: {
          kind: "matrix_cell",
          variableName: "dp",
          rowSource: "i",
          columnSource: "j"
        }
      },
      span
    },
    { rootId: "r-negative", kind: "return", expressionExprId: "r-negative.0", span },
    { rootId: "r-invalid", kind: "return", expressionExprId: "r-invalid.0", span }
  ],
  expressions: [
    {
      exprId: "r-list.0", rootId: "r-list", parentExprId: null, kind: "subscript", span,
      source: "nums[i]", childExprIds: [],
      structureHint: { kind: "list_index", variableName: "nums", indexExprId: "r-list.i" }
    },
    { exprId: "r-list.i", rootId: "r-list", parentExprId: "r-list.0", kind: "name", span, source: "i", childExprIds: [] },
    {
      exprId: "r-matrix.0", rootId: "r-matrix", parentExprId: null, kind: "call", span,
      source: "min(dp[i - 1][j], grid[i][j])", childExprIds: ["r-matrix.dp", "r-matrix.grid"]
    },
    {
      exprId: "r-matrix.dp", rootId: "r-matrix", parentExprId: "r-matrix.0", kind: "subscript", span,
      source: "dp[i - 1][j]", childExprIds: [],
      structureHint: { kind: "matrix_cell", variableName: "dp", rowExprId: "r-matrix.row", columnExprId: "r-matrix.column" }
    },
    { exprId: "r-matrix.row", rootId: "r-matrix", parentExprId: "r-matrix.dp", kind: "binary", span, source: "i - 1", childExprIds: [] },
    { exprId: "r-matrix.column", rootId: "r-matrix", parentExprId: "r-matrix.dp", kind: "name", span, source: "j", childExprIds: [] },
    {
      exprId: "r-matrix.grid", rootId: "r-matrix", parentExprId: "r-matrix.0", kind: "subscript", span,
      source: "grid[i][j]", childExprIds: [],
      structureHint: { kind: "matrix_cell", variableName: "grid", rowExprId: "r-matrix.grid-row", columnExprId: "r-matrix.grid-column" }
    },
    { exprId: "r-matrix.grid-row", rootId: "r-matrix", parentExprId: "r-matrix.grid", kind: "name", span, source: "i", childExprIds: [] },
    { exprId: "r-matrix.grid-column", rootId: "r-matrix", parentExprId: "r-matrix.grid", kind: "name", span, source: "j", childExprIds: [] },
    {
      exprId: "r-negative.0", rootId: "r-negative", parentExprId: null, kind: "subscript", span,
      source: "nums[-1]", childExprIds: [],
      structureHint: { kind: "list_index", variableName: "nums", indexExprId: "r-negative.index" }
    },
    { exprId: "r-negative.index", rootId: "r-negative", parentExprId: "r-negative.0", kind: "literal", span, source: "-1", childExprIds: [] },
    {
      exprId: "r-invalid.0", rootId: "r-invalid", parentExprId: null, kind: "subscript", span,
      source: "nums[unknown]", childExprIds: [],
      structureHint: { kind: "list_index", variableName: "nums", indexExprId: "r-invalid.index" }
    },
    { exprId: "r-invalid.index", rootId: "r-invalid", parentExprId: "r-invalid.0", kind: "name", span, source: "unknown", childExprIds: [] }
  ]
};

function root(rootId: string): ExpressionRootDescriptor {
  return plan.roots.find((item) => item.rootId === rootId)!;
}

function evaluation(
  rootId: string,
  values: Array<[string, ValueSnapshot]>,
  selections: ExpressionRootEvaluation["selectionEvidence"] = []
): ExpressionRootEvaluation {
  return {
    rootId,
    status: "completed",
    evaluations: values.map(([exprId, value], index) => ({
      evaluationId: index + 1,
      exprId,
      order: index + 1,
      value
    })),
    selectionEvidence: selections
  };
}

describe("projectStructureReferences", () => {
  it("projects captured list and matrix read coordinates and upgrades only the selected candidate", () => {
    const listReferences = projectStructureReferences(
      plan,
      root("r-list"),
      evaluation("r-list", [["r-list.i", int(2)]]),
      runtime({ nums: list([4, 7, 9]) })
    );
    const matrixReferences = projectStructureReferences(
      plan,
      root("r-matrix"),
      evaluation("r-matrix", [
        ["r-matrix.row", int(1)], ["r-matrix.column", int(2)],
        ["r-matrix.grid-row", int(2)], ["r-matrix.grid-column", int(1)]
      ], [{
        callExprId: "r-matrix.0",
        function: "min",
        candidateExprIds: ["r-matrix.dp", "r-matrix.grid"],
        result: int(4),
        selectedCandidateIndex: 1,
        status: "resolved"
      }]),
      runtime({ dp: matrix([[0, 0, 0], [0, 0, 0]]), grid: matrix([[1, 2], [3, 4], [5, 6]]) })
    );

    expect(listReferences).toEqual([{
      exprId: "r-list.0", variableName: "nums", kind: "list_index",
      index: 2, rawIndex: 2, role: "operand"
    }]);
    expect(matrixReferences).toEqual(expect.arrayContaining([
      {
        exprId: "r-matrix.dp", variableName: "dp", kind: "matrix_cell",
        row: 1, column: 2, rawRow: 1, rawColumn: 2, role: "operand"
      },
      {
        exprId: "r-matrix.grid", variableName: "grid", kind: "matrix_cell",
        row: 2, column: 1, rawRow: 2, rawColumn: 1, role: "selected_operand"
      }
    ]));
  });

  it("normalizes captured negative read indexes while retaining their raw value", () => {
    expect(projectStructureReferences(
      plan,
      root("r-negative"),
      evaluation("r-negative", [["r-negative.index", int(-1)]]),
      runtime({ nums: list([4, 7, 9]) })
    )).toEqual([{
      exprId: "r-negative.0", variableName: "nums", kind: "list_index",
      index: 2, rawIndex: -1, role: "operand"
    }]);
  });

  it("projects simple-local assignment targets from anchored locals", () => {
    expect(projectStructureReferences(
      plan,
      root("r-matrix"),
      evaluation("r-matrix", []),
      runtime({ dp: matrix([[0, 0, 0], [0, 0, 0]]), i: int(1), j: int(2) })
    )).toEqual([{
      exprId: "r-matrix:target", variableName: "dp", kind: "matrix_cell",
      row: 1, column: 2, rawRow: 1, rawColumn: 2, role: "assignment_target"
    }]);
  });

  it("fails closed for out-of-bounds and unresolved coordinates", () => {
    expect(projectStructureReferences(
      plan,
      root("r-list"),
      evaluation("r-list", [["r-list.i", int(99)]]),
      runtime({ nums: list([4, 7, 9]) })
    )).toEqual([]);
    expect(projectStructureReferences(
      plan,
      root("r-invalid"),
      evaluation("r-invalid", [["r-invalid.index", { type: "str", value: "2", length: 1, truncated: false }]]),
      runtime({ nums: list([4, 7, 9]) })
    )).toEqual([]);
  });
});
