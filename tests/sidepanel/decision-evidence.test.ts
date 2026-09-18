import { describe, expect, it, vi } from "vitest";

import type {
  DecisionChainEvidence,
  DecisionHistoryEntry,
  DecisionStepEvidence
} from "../../src/shared/decision-types";
import { createDecisionEvidence } from "../../src/sidepanel/components/DecisionEvidence";

const int = (value: number) => ({ type: "int" as const, value: String(value) });

function node(
  conditionId: string,
  status: DecisionStepEvidence["condition"]["status"],
  truth?: boolean,
  children: DecisionStepEvidence["condition"]["children"] = []
): DecisionStepEvidence["condition"] {
  return {
    conditionId,
    kind: "and",
    source: "left and right",
    status,
    ...(truth === undefined ? {} : { truth }),
    operands: [{ operandId: `${conditionId}.o1`, source: "left", value: int(1) }],
    children
  };
}

const evidence: DecisionStepEvidence = {
  context: { loopStack: [] },
  anchorStep: 4,
  frameId: 2,
  siteId: "d1",
  occurrence: 1,
  status: "completed",
  outcome: "branch_entered",
  condition: node("d1.c0", "evaluated", true, [
    node("d1.c0.0", "evaluated", false, []),
    node("d1.c0.1", "short_circuited", undefined, []),
    node("d1.c0.2", "not_reached", undefined, [])
  ]),
  structureReferences: []
};

const chain: DecisionChainEvidence = {
  chainId: "chain1",
  selectedBranchIndex: 1,
  branches: [
    { branchIndex: 0, kind: "if", status: "rejected", siteId: "d1", condition: evidence.condition, anchorStep: 4 },
    { branchIndex: 1, kind: "elif", status: "selected", siteId: "d2", condition: node("d2.c0", "evaluated", true), anchorStep: 7 },
    { branchIndex: 2, kind: "else", status: "not_reached" }
  ]
};

const history: DecisionHistoryEntry[] = [
  {
    siteId: "d3",
    occurrence: 1,
    anchorStep: 8,
    frameId: 2,
    status: "completed",
    truth: true,
    outcome: "loop_body_entered",
    condition: node("d3.c0", "evaluated", true)
  },
  {
    siteId: "d3",
    occurrence: 2,
    anchorStep: 9,
    frameId: 2,
    status: "completed",
    truth: false,
    outcome: "loop_exited",
    condition: node("d3.c0", "evaluated", false)
  }
];

describe("createDecisionEvidence", () => {
  it("renders evaluated, short-circuited, not-reached, and factual partial states distinctly", () => {
    const view = createDecisionEvidence({
      evidence,
      tracingState: { status: "complete" },
      chain: undefined,
      history: [],
      onNavigateStep: vi.fn()
    });

    expect(view.querySelector<HTMLElement>('[data-condition-id="d1.c0"]')?.dataset.conditionStatus).toBe("evaluated");
    expect(view.querySelector<HTMLElement>('[data-condition-id="d1.c0"]')?.dataset.conditionTruth).toBe("true");
    expect(view.querySelector<HTMLElement>('[data-condition-id="d1.c0.0"]')?.dataset.conditionTruth).toBe("false");
    expect(view.querySelector<HTMLElement>('[data-condition-id="d1.c0.1"]')?.dataset.conditionStatus).toBe("short_circuited");
    expect(view.querySelector<HTMLElement>('[data-condition-id="d1.c0.2"]')?.dataset.conditionStatus).toBe("not_reached");
    expect(view.textContent).toContain("AND short-circuited");
    expect(view.textContent).not.toMatch(/short-circuited[^\n]*False/i);

    const partial = createDecisionEvidence({
      evidence: { ...evidence, status: "partial", outcome: undefined, condition: node("partial", "partial") },
      tracingState: { status: "truncated", reason: "decision_event_limit" },
      chain: undefined,
      history: [],
      onNavigateStep: vi.fn()
    });
    expect(partial.querySelector('[data-condition-status="partial"]')).not.toBeNull();
    expect(partial.textContent).toContain("condition partial");
    expect(partial.textContent).not.toContain("condition True");
    expect(partial.textContent).not.toContain("condition False");
  });

  it("renders branch status and navigable while history using raw anchor steps", () => {
    const onNavigateStep = vi.fn();
    const view = createDecisionEvidence({
      evidence,
      tracingState: { status: "complete" },
      chain,
      history,
      onNavigateStep
    });

    expect(view.querySelector('[data-branch-status="selected"]')?.textContent).toContain("Selected");
    expect(view.querySelector('[data-branch-status="rejected"]')?.textContent).toContain("Rejected");
    expect(view.querySelector('[data-branch-status="not_reached"]')?.textContent).toContain("Not reached");
    const button = view.querySelector<HTMLButtonElement>('[data-anchor-step="9"]');
    expect(button?.textContent).toContain("loop_exited");
    button?.click();
    expect(onNavigateStep).toHaveBeenCalledWith(9);
    expect(view.textContent).toContain("loop_body_entered");
    expect(view.textContent).toContain("loop_exited");
  });
});
