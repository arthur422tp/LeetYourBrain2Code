import { describe, expect, it } from "vitest";

import type {
  CrossRunDivergence,
  CrossRunDivergenceKind
} from "../../src/core/cross-run-diff";
import {
  buildCaseDivergencePresentation
} from "../../src/sidepanel/case-diff-presentation";

const allKinds: CrossRunDivergenceKind[] = [
  "frame_argument_changed",
  "child_call_changed",
  "child_call_missing",
  "child_call_extra",
  "decision_truth_changed",
  "decision_outcome_changed",
  "decision_completion_changed",
  "decision_operand_changed",
  "decision_structure_changed",
  "expression_value_changed",
  "expression_selection_changed",
  "expression_structure_changed",
  "loop_iteration_binding_changed",
  "iteration_status_changed",
  "transfer_presence_changed",
  "transfer_status_changed",
  "loop_exit_reason_changed",
  "mutation_value_changed",
  "mutation_presence_changed",
  "frame_exit_status_changed",
  "return_value_changed",
  "exception_type_changed",
  "trace_end_reason_changed",
  "session_outcome_changed"
];

function divergence(
  kind: CrossRunDivergenceKind,
  confidence: CrossRunDivergence["alignmentConfidence"] = "strong"
): CrossRunDivergence {
  return {
    kind,
    alignmentConfidence: confidence,
    baseline: {
      frameKey: "solve",
      step: 8,
      factualText: "left evidence"
    },
    current: {
      frameKey: "solve",
      step: 13,
      factualText: "right evidence"
    }
  };
}

describe("case divergence presentation", () => {
  it("maps every current divergence kind to a factual category and title", () => {
    const presentations = allKinds.map((kind) =>
      buildCaseDivergencePresentation(divergence(kind), 0, 2)
    );

    expect(presentations).toHaveLength(allKinds.length);
    expect(presentations.every((presentation) => presentation !== undefined)).toBe(true);
    expect(new Set(presentations.map((presentation) => presentation?.category))).toEqual(
      new Set(["decision", "mutation", "call", "control_flow", "expression", "termination"])
    );
    expect(presentations.map((presentation) => presentation?.title)).toContain("Decision differs");
    expect(presentations.map((presentation) => presentation?.title)).toContain("State change differs");
    expect(presentations.map((presentation) => presentation?.title)).toContain("Call behavior differs");
    expect(presentations.map((presentation) => presentation?.title)).toContain("Control flow differs");
    expect(presentations.map((presentation) => presentation?.title)).toContain("Expression differs");
    expect(presentations.map((presentation) => presentation?.title)).toContain("Termination differs");
  });

  it("uses one-based Case labels and preserves each anchor step and factual text", () => {
    const presentation = buildCaseDivergencePresentation(divergence("decision_truth_changed"), 0, 2);

    expect(presentation).toMatchObject({
      left: { caseLabel: "Case 1", step: 8, factualText: "left evidence" },
      right: { caseLabel: "Case 3", step: 13, factualText: "right evidence" },
      confidence: "strong"
    });
  });

  it("does not introduce causal or correctness language", () => {
    const presentation = buildCaseDivergencePresentation(divergence("mutation_value_changed"), 0, 1);

    expect(JSON.stringify(presentation)).not.toMatch(
      /wrong branch|bug|root cause|correct case|bad case|fix|should/i
    );
  });

  it("preserves fallback confidence and adds only a neutral alignment note", () => {
    const presentation = buildCaseDivergencePresentation(
      divergence("child_call_extra", "fallback"),
      1,
      3
    );

    expect(presentation?.confidence).toBe("fallback");
    expect(presentation?.detail).toContain("fallback");
    expect(presentation?.detail).not.toMatch(/correct|wrong|cause|bug/i);
  });

  it("does not present an ambiguous alignment as a matched divergence", () => {
    expect(buildCaseDivergencePresentation(
      divergence("decision_truth_changed", "ambiguous"),
      0,
      2
    )).toBeUndefined();
  });

  it("returns no card when no divergence was observed", () => {
    expect(buildCaseDivergencePresentation(undefined, 0, 2)).toBeUndefined();
  });
});
