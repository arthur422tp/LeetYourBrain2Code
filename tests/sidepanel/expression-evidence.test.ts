import { describe, expect, it } from "vitest";

import type {
  ExpressionStepEvidence,
  ExpressionTracingState
} from "../../src/shared/expression-types";
import { createExpressionEvidence } from "../../src/sidepanel/components/ExpressionEvidence";

const int = (value: number) => ({ type: "int" as const, value: String(value) });
const span = { line: 3, column: 0, endLine: 3, endColumn: 8 };

const completedAssignment: ExpressionStepEvidence = {
  anchorStep: 1,
  frameId: 4,
  roots: [{
    rootId: "r1",
    kind: "assignment",
    status: "completed",
    target: { source: "total", span },
    tree: {
      exprId: "r1.0",
      kind: "binary",
      source: "a + b",
      value: int(3),
      children: [
        { exprId: "r1.0.0", kind: "name", source: "a", value: int(1), children: [] },
        { exprId: "r1.0.1", kind: "name", source: "b", value: int(2), children: [] }
      ]
    },
    selections: [],
    structureReferences: []
  }]
};

describe("createExpressionEvidence", () => {
  it("renders a completed assignment root and its factual tree values", () => {
    const view = createExpressionEvidence(completedAssignment, { status: "complete" });

    expect(view.querySelector('[data-expression-root="r1"]')).not.toBeNull();
    expect(view.textContent).toContain("total =");
    expect(view.textContent).toContain("a + b");
    expect(view.textContent).toContain("3");
    expect(view.textContent).toContain("a");
  });

  it("renders return roots and marks an explicitly selected candidate", () => {
    const evidence: ExpressionStepEvidence = {
      anchorStep: 2,
      frameId: 4,
      roots: [{
        rootId: "r2",
        kind: "return",
        status: "completed",
        tree: {
          exprId: "r2.call",
          kind: "call",
          source: "min(a, b)",
          value: int(2),
          children: [
            { exprId: "r2.left", kind: "name", source: "a", value: int(2), children: [] },
            { exprId: "r2.right", kind: "name", source: "b", value: int(5), children: [] }
          ]
        },
        selections: [{
          callExprId: "r2.call",
          function: "min",
          candidateExprIds: ["r2.left", "r2.right"],
          result: int(2),
          selectedCandidateIndex: 0,
          status: "resolved"
        }],
        structureReferences: []
      }]
    };

    const view = createExpressionEvidence(evidence, undefined);

    expect(view.querySelector('[data-expression-root="r2"]')).not.toBeNull();
    expect(view.querySelector('[data-expression-id="r2.left"][data-expression-selected="true"]'))
      .not.toBeNull();
    expect(view.querySelector('[data-expression-id="r2.right"][data-expression-selected="true"]'))
      .toBeNull();
  });

  it("keeps a partial root factual without fabricating a missing result", () => {
    const evidence: ExpressionStepEvidence = {
      anchorStep: 3,
      frameId: 4,
      roots: [{
        rootId: "r-partial",
        kind: "assignment",
        status: "partial",
        target: { source: "x", span },
        tree: {
          exprId: "r-partial.0",
          kind: "binary",
          source: "10 / 0",
          children: [{ exprId: "r-partial.0.0", kind: "literal", source: "10", value: int(10), children: [] }]
        },
        selections: [],
        structureReferences: []
      }]
    };

    const view = createExpressionEvidence(evidence, undefined);

    expect(view.querySelector('[data-expression-root="r-partial"]')).not.toBeNull();
    expect(view.textContent).toContain("partial");
    expect(view.textContent).not.toContain("undefined");
    expect(view.textContent).not.toContain("null");
  });

  it("renders the exact empty state and tracing truncation status", () => {
    const empty = createExpressionEvidence(undefined, undefined);
    expect(empty.textContent).toBe("No expression evidence for this step.");

    const tracingState: ExpressionTracingState = {
      status: "truncated",
      reason: "expression_event_limit"
    };
    const truncated = createExpressionEvidence(undefined, tracingState);
    expect(truncated.textContent).toContain("Expression tracing truncated");
    expect(truncated.textContent).toContain("expression_event_limit");
  });
});
