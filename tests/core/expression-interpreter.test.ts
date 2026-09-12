import { describe, expect, it } from "vitest";

import { buildExpressionEvidence } from "../../src/core/expression-interpreter";
import type { RuntimeState } from "../../src/core/runtime-state";
import type {
  ExpressionBatch,
  ExpressionPlan
} from "../../src/shared/expression-types";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function runtimeState(step: number): RuntimeState {
  return {
    step,
    activeFrameId: 4,
    frames: new Map(),
    callStack: [4],
    currentLine: 7,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

const plan: ExpressionPlan = {
  version: 1,
  roots: [{
    rootId: "r1",
    kind: "assignment",
    expressionExprId: "r1.0",
    target: {
      source: "x",
      span: { line: 1, column: 0, endLine: 1, endColumn: 1 }
    },
    span: { line: 1, column: 0, endLine: 1, endColumn: 39 }
  }],
  expressions: [
    {
      exprId: "r1.0",
      rootId: "r1",
      parentExprId: null,
      kind: "call",
      span: { line: 1, column: 4, endLine: 1, endColumn: 39 },
      source: "max(dp[i - 1], dp[i - 2] + nums[i])",
      childExprIds: ["r1.1", "r1.2"]
    },
    {
      exprId: "r1.1",
      rootId: "r1",
      parentExprId: "r1.0",
      kind: "subscript",
      span: { line: 1, column: 8, endLine: 1, endColumn: 17 },
      source: "dp[i - 1]",
      childExprIds: []
    },
    {
      exprId: "r1.2",
      rootId: "r1",
      parentExprId: "r1.0",
      kind: "binary",
      span: { line: 1, column: 19, endLine: 1, endColumn: 38 },
      source: "dp[i - 2] + nums[i]",
      childExprIds: ["r1.3", "r1.4"]
    },
    {
      exprId: "r1.3",
      rootId: "r1",
      parentExprId: "r1.2",
      kind: "subscript",
      span: { line: 1, column: 19, endLine: 1, endColumn: 28 },
      source: "dp[i - 2]",
      childExprIds: []
    },
    {
      exprId: "r1.4",
      rootId: "r1",
      parentExprId: "r1.2",
      kind: "subscript",
      span: { line: 1, column: 31, endLine: 1, endColumn: 38 },
      source: "nums[i]",
      childExprIds: []
    }
  ]
};

function batch(anchorStep: number, roots: ExpressionBatch["roots"]): ExpressionBatch {
  return { batchId: anchorStep, anchorStep, frameId: 4, line: 1, roots };
}

describe("buildExpressionEvidence", () => {
  it("reconstructs the static AST tree order and preserves captured selection evidence", () => {
    const selection = {
      callExprId: "r1.0",
      function: "max" as const,
      candidateExprIds: ["r1.1", "r1.2"],
      result: int(8),
      selectedCandidateIndex: 1,
      status: "resolved" as const
    };
    const evidence = buildExpressionEvidence(plan, [batch(1, [{
      rootId: "r1",
      status: "completed",
      resultExprId: "r1.0",
      evaluations: [
        { evaluationId: 1, exprId: "r1.1", order: 1, value: int(3) },
        { evaluationId: 2, exprId: "r1.3", order: 2, value: int(5) },
        { evaluationId: 3, exprId: "r1.4", order: 3, value: int(3) },
        { evaluationId: 4, exprId: "r1.2", order: 4, value: int(8) },
        { evaluationId: 5, exprId: "r1.0", order: 5, value: int(8) }
      ],
      selectionEvidence: [selection]
    }])], [runtimeState(1)]);

    const root = evidence.get(1)?.roots[0]!;
    expect(root.tree.source).toBe("max(dp[i - 1], dp[i - 2] + nums[i])");
    expect(root.tree.children.map((child) => child.exprId)).toEqual(["r1.1", "r1.2"]);
    expect(root.tree.children[1]?.children.map((child) => child.exprId)).toEqual(["r1.3", "r1.4"]);
    expect(root.selections).toEqual([selection]);
    expect(root.selections[0]?.selectedCandidateIndex).toBe(1);
  });

  it("retains a partial root when only child evaluations were captured", () => {
    const evidence = buildExpressionEvidence(plan, [batch(1, [{
      rootId: "r1",
      status: "partial",
      evaluations: [{ evaluationId: 1, exprId: "r1.1", order: 1, value: int(3) }]
    }])], [runtimeState(1)]);

    const root = evidence.get(1)?.roots[0]!;
    expect(root.status).toBe("partial");
    expect(root.tree.value).toBeUndefined();
    expect(root.tree.children[0]?.value).toEqual(int(3));
  });

  it("keeps runtime occurrences of a static expression separate by anchor step", () => {
    const evidence = buildExpressionEvidence(plan, [
      batch(1, [{
        rootId: "r1",
        status: "completed",
        evaluations: [{ evaluationId: 1, exprId: "r1.0", order: 1, value: int(8) }]
      }]),
      batch(2, [{
        rootId: "r1",
        status: "completed",
        evaluations: [{ evaluationId: 2, exprId: "r1.0", order: 1, value: int(13) }]
      }])
    ], [runtimeState(1), runtimeState(2)]);

    expect(evidence.get(1)?.roots[0]?.tree.value).toEqual(int(8));
    expect(evidence.get(2)?.roots[0]?.tree.value).toEqual(int(13));
  });

  it("skips unknown roots and expression IDs and ignores batches without a runtime anchor", () => {
    const evidence = buildExpressionEvidence(plan, [
      batch(1, [
        { rootId: "missing-root", status: "completed", evaluations: [] },
        {
          rootId: "r1",
          status: "completed",
          evaluations: [
            { evaluationId: 1, exprId: "missing-expression", order: 1, value: int(99) },
            { evaluationId: 2, exprId: "r1.0", order: 2, value: int(8) }
          ]
        }
      ]),
      batch(2, [{ rootId: "r1", status: "completed", evaluations: [] }])
    ], [runtimeState(1)]);

    expect(evidence.get(1)?.roots).toHaveLength(1);
    expect(evidence.get(1)?.roots[0]?.tree.value).toEqual(int(8));
    expect(evidence.has(2)).toBe(false);
  });
});
