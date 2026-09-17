import { describe, expect, it } from "vitest";

import { projectDecisionStructureReferences } from "../../src/core/decision-structure-projection";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });
const list = (...items: ValueSnapshot[]): ValueSnapshot => ({ type: "list", length: items.length, items, truncated: false });
const span = { line: 1, column: 0, endLine: 1, endColumn: 1 };

function runtime(locals: Record<string, ValueSnapshot>): RuntimeState {
  return {
    step: 1,
    activeFrameId: 4,
    frames: new Map([[4, { frameId: 4, parentFrameId: null, functionName: "solve", line: 1, locals }]]),
    callStack: [4],
    currentLine: 1,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

function batch(evaluations: DecisionBatch["condition"]["evaluations"]): DecisionBatch {
  return {
    batchId: 1,
    anchorStep: 1,
    frameId: 4,
    siteId: "d1",
    occurrence: 1,
    status: "completed",
    condition: {
      conditionId: "d1.c0",
      evaluations,
      conditionResults: [{ conditionId: "d1.c0", order: 1, truth: true }],
      truth: true
    },
    outcome: "branch_entered"
  };
}

describe("projectDecisionStructureReferences", () => {
  it("resolves a captured list index including negative normalization", () => {
    const plan: ConditionPlan = {
      version: 1,
      sites: [{ siteId: "d1", kind: "if", conditionId: "d1.c0", span }],
      conditions: [{ conditionId: "d1.c0", siteId: "d1", kind: "comparison", source: "nums[i] == 1", span, childConditionIds: [], operandIds: ["d1.c0.o0", "d1.c0.o1"] }],
      operands: [
        { operandId: "d1.c0.o0", conditionId: "d1.c0", source: "i", span },
        { operandId: "d1.c0.o1", conditionId: "d1.c0", source: "nums[i]", span, structureHint: { kind: "list_index", variableName: "nums", indexOperandId: "d1.c0.o0" } }
      ],
      chains: []
    };

    expect(projectDecisionStructureReferences(plan, batch([
      { operandId: "d1.c0.o0", order: 1, value: int(-1) },
      { operandId: "d1.c0.o1", order: 2, value: int(3) }
    ]), runtime({ nums: list(int(1), int(2), int(3)), i: int(-1) }))).toEqual([{
      operandId: "d1.c0.o1", variableName: "nums", kind: "list_index", index: 2, rawIndex: -1, role: "condition_operand"
    }]);
  });

  it("resolves matrix coordinates only when both captured coordinates form a complete rectangular matrix", () => {
    const plan: ConditionPlan = {
      version: 1,
      sites: [{ siteId: "d1", kind: "if", conditionId: "d1.c0", span }],
      conditions: [{ conditionId: "d1.c0", siteId: "d1", kind: "comparison", source: "grid[r][c] == 1", span, childConditionIds: [], operandIds: ["row", "column", "cell"] }],
      operands: [
        { operandId: "row", conditionId: "d1.c0", source: "r", span },
        { operandId: "column", conditionId: "d1.c0", source: "c", span },
        { operandId: "cell", conditionId: "d1.c0", source: "grid[r][c]", span, structureHint: { kind: "matrix_cell", variableName: "grid", rowOperandId: "row", columnOperandId: "column" } }
      ],
      chains: []
    };
    const grid = list(list(int(0), int(1)), list(int(1), int(0)));
    expect(projectDecisionStructureReferences(plan, batch([
      { operandId: "row", order: 1, value: int(1) },
      { operandId: "column", order: 2, value: int(-1) },
      { operandId: "cell", order: 3, value: int(0) }
    ]), runtime({ grid, r: int(1), c: int(-1) }))).toEqual([{
      operandId: "cell", variableName: "grid", kind: "matrix_cell", row: 1, column: 1, rawRow: 1, rawColumn: -1, role: "condition_operand"
    }]);

    expect(projectDecisionStructureReferences(plan, batch([
      { operandId: "row", order: 1, value: int(1) },
      { operandId: "cell", order: 2, value: int(0) }
    ]), runtime({ grid, r: int(1), c: int(0) }))).toEqual([]);
    expect(projectDecisionStructureReferences(plan, batch([
      { operandId: "row", order: 1, value: int(1) },
      { operandId: "column", order: 2, value: int(0) },
      { operandId: "cell", order: 3, value: int(0) }
    ]), runtime({ grid: list(list(int(0)), list(int(1), int(0))), r: int(1), c: int(0) }))).toEqual([]);
  });
});
