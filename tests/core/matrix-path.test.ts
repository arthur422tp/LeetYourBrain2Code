import { describe, expect, it } from "vitest";
import { createMatrixPathTracker, matrixPathTo } from "../../src/core/matrix-path";
import type { MatrixVisualModel } from "../../src/core/matrix-interpreter";
import type { ExpressionEvidenceNode, ExpressionEvidenceRoot } from "../../src/shared/expression-types";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const span = { line: 1, column: 0, endLine: 1, endColumn: 1 };
function matrices(values = [[0, 0], [0, 0]]): MatrixVisualModel[] {
  return ["costs", "board"].map((variableName) => ({
    kind: "matrix", visualId: `matrix:${variableName}`, variableName,
    rowCount: values.length, columnCount: values[0].length,
    cells: values.map((row) => row.map(int)), focuses: [], changedCells: [], expressionReferences: []
  }));
}
function assignment(row: number, column: number, value: number, candidates: number[][] = [], selected = 0): ExpressionEvidenceRoot {
  const target = { exprId: "target", kind: "matrix_cell" as const, variableName: "costs", row, column, rawRow: row, rawColumn: column, role: "assignment_target" as const };
  const source = { ...target, exprId: "source", variableName: "board", role: "operand" as const };
  const refs = candidates.map(([r, c], index) => ({ ...target, exprId: `p${index}`, row: r, column: c, rawRow: r, rawColumn: c, role: index === selected ? "selected_operand" as const : "operand" as const }));
  const sourceNode: ExpressionEvidenceNode = { exprId: "source", kind: "subscript", source: `board[${row}][${column}]`, value: int(value), children: [] };
  const input: ExpressionEvidenceNode = candidates.length === 1
    ? { exprId: "p0", kind: "subscript", source: "costs[r][c]", value: int(0), children: [] }
    : { exprId: "choice", kind: "call", source: "min(costs[a][b], costs[c][d])", value: int(0), children: [] };
  return {
    rootId: "assignment", kind: "assignment", status: "completed", target: { source: "costs[r][c]", span },
    tree: candidates.length ? { exprId: "sum", kind: "binary", source: `${input.source} + ${sourceNode.source}`, value: int(value), children: [input, sourceNode] } : sourceNode,
    structureReferences: [target, source, ...refs],
    selections: candidates.length < 2 ? [] : [{ callExprId: "choice", function: "min", candidateExprIds: refs.map((ref) => ref.exprId), result: int(0), selectedCandidateIndex: selected, status: "resolved" }]
  };
}

describe("recorded matrix paths", () => {
  it("records zero writes, boundary chains and immutable snapshots without variable-name heuristics", () => {
    const tracker = createMatrixPathTracker();
    const before = matrices();
    tracker.update(1, before, [assignment(0, 0, 0)]);
    expect(before[0].path).toBeUndefined();
    const base = matrices();
    tracker.update(1, base, [assignment(0, 1, 0, [[0, 0]])]);
    const right = matrices();
    tracker.update(1, right, [assignment(1, 1, 0, [[0, 1]])]);
    const final = matrices();
    tracker.update(1, final, []);
    expect(matrixPathTo(final[0].path!, { row: 1, column: 1 }).map(({ row, column }) => [row, column]))
      .toEqual([[0, 0], [0, 1], [1, 1]]);
    expect(final[1].path).toBe(final[0].path);
    expect(base[0].path?.nodes.size).toBe(1);
    expect(right[0].path?.nodes.size).toBe(2);
    const otherFrame = matrices();
    tracker.update(2, otherFrame, []);
    expect(otherFrame[0].path).toBeUndefined();
  });

  it("uses the recorded candidate index on a tie and reports missing or unresolved predecessors", () => {
    const tracker = createMatrixPathTracker();
    tracker.update(1, matrices(), [assignment(1, 0, 0)]);
    tracker.update(1, matrices(), [assignment(1, 1, 0, [[0, 1], [1, 0]], 1)]);
    const selected = matrices();
    const ambiguous = assignment(1, 1, 0, [[0, 1], [1, 0]]);
    ambiguous.selections[0].status = "ambiguous";
    ambiguous.selections[0].selectedCandidateIndex = null;
    tracker.update(1, selected, [ambiguous]);
    expect(selected[0].path?.nodes.get("1:1")?.previous).toMatchObject({ row: 1, column: 0 });
    const unresolved = matrices();
    tracker.update(1, unresolved, [assignment(0, 1, 0, [[0, 0]])]);
    expect(unresolved[0].path?.nodes.get("1:1")).toMatchObject({ complete: false, previous: undefined });
    const missing = matrices();
    tracker.update(1, missing, []);
    expect(missing[0].path?.nodes.get("0:1")?.complete).toBe(false);
  });

  it("does not claim an assignment that failed to appear in the next snapshot", () => {
    const tracker = createMatrixPathTracker();
    tracker.update(1, matrices(), [assignment(0, 0, 9)]);
    const failed = matrices();
    tracker.update(1, failed, []);
    expect(failed[0].path).toBeUndefined();
  });

  it("does not expose an upcoming selection before the first path assignment commits", () => {
    const tracker = createMatrixPathTracker();
    const root = assignment(1, 1, 0, [[0, 1], [1, 0]]);
    const before = matrices();
    before[0].expressionReferences = root.structureReferences.filter((ref) => ref.variableName === "costs");
    tracker.update(1, before, [root]);
    expect(before[0].expressionReferences.some((ref) => ref.role === "selected_operand")).toBe(false);
    expect(before[0].path?.nodes.has("1:1")).not.toBe(true);
  });

  it("removes provenance when a captured unsupported write replaces a cell with the same value", () => {
    const tracker = createMatrixPathTracker();
    tracker.update(1, matrices(), [assignment(0, 0, 0)]);
    const unsupported = assignment(0, 0, 0);
    unsupported.tree = { exprId: "literal", kind: "literal", source: "0", value: int(0), children: [] };
    tracker.update(1, matrices(), [unsupported]);
    const after = matrices();
    tracker.update(1, after, []);
    expect(after[0].path?.nodes.has("0:0")).not.toBe(true);
    const sameLine = createMatrixPathTracker();
    sameLine.update(1, matrices(), [assignment(0, 0, 0), unsupported]);
    const overwritten = matrices();
    sameLine.update(1, overwritten, []);
    expect(overwritten[0].path?.nodes.has("0:0")).not.toBe(true);
  });

  it("selects the returned cell's recorded route instead of the last cell written", () => {
    const tracker = createMatrixPathTracker();
    tracker.update(1, matrices(), [assignment(0, 0, 0)]);
    tracker.update(1, matrices(), [assignment(0, 1, 0, [[0, 0]])]);
    const root = assignment(0, 0, 0);
    root.kind = "return";
    root.tree = { exprId: "returned", kind: "subscript", source: "costs[0][0]", value: int(0), children: [] };
    root.structureReferences = [{ exprId: "returned", kind: "matrix_cell", variableName: "costs", row: 0, column: 0, rawRow: 0, rawColumn: 0, role: "operand" }];
    const returned = matrices();
    tracker.update(1, returned, [root]);
    expect(returned[0].path?.endpoint).toEqual({ row: 0, column: 0 });
    root.structureReferences[0] = { ...root.structureReferences[0], kind: "matrix_cell", row: 1, column: 1, rawRow: 1, rawColumn: 1 };
    const uncapturedReturn = matrices();
    tracker.update(1, uncapturedReturn, [root]);
    expect(uncapturedReturn[0].path?.endpoint).toEqual({ row: 1, column: 1 });
    expect(matrixPathTo(uncapturedReturn[0].path!, { row: 1, column: 1 })).toEqual([]);
  });

  it("clears a path when its source changes or its matrix becomes unavailable", () => {
    const tracker = createMatrixPathTracker();
    tracker.update(1, matrices(), [assignment(0, 0, 0)]);
    tracker.update(1, matrices(), []);
    const changed = matrices();
    changed[1].changedCells = [{ row: 0, column: 0, action: "changed", before: int(0), after: int(1) }];
    tracker.update(1, changed, []);
    expect(changed[0].path).toBeUndefined();
    tracker.update(1, matrices(), [assignment(0, 0, 0)]);
    tracker.update(1, matrices(), []);
    tracker.update(1, [], []);
    const restored = matrices();
    tracker.update(1, restored, []);
    expect(restored[0].path).toBeUndefined();
  });
});
