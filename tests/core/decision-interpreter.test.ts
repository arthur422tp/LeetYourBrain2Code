import { describe, expect, it } from "vitest";

import { buildDecisionEvidence } from "../../src/core/decision-interpreter";
import type { RuntimeState } from "../../src/core/runtime-state";
import type { ConditionPlan, DecisionBatch } from "../../src/shared/decision-types";

const span = { line: 1, column: 0, endLine: 1, endColumn: 1 };

function runtimeState(step: number, frameId = 1): RuntimeState {
  return {
    step,
    activeFrameId: frameId,
    frames: new Map(),
    callStack: [frameId],
    currentLine: 1,
    stdout: "",
    objectTopology: { objects: new Map(), truncated: false }
  };
}

function planFor(kind: "and" | "or" = "and"): ConditionPlan {
  return {
    version: 1,
    sites: [{ siteId: "d1", kind: "if", conditionId: "d1.c0", span }],
    conditions: [
      { conditionId: "d1.c0", siteId: "d1", kind, source: "A and B", span, childConditionIds: ["d1.c0.0", "d1.c0.1"], operandIds: [] },
      { conditionId: "d1.c0.0", siteId: "d1", kind: "truth_test", source: "A", span, childConditionIds: [], operandIds: [] },
      { conditionId: "d1.c0.1", siteId: "d1", kind: "truth_test", source: "B", span, childConditionIds: [], operandIds: [] }
    ],
    operands: [],
    chains: []
  };
}

function batch(results: Array<[string, boolean]>, status: "completed" | "partial" = "completed"): DecisionBatch {
  return {
    batchId: 1,
    anchorStep: 1,
    frameId: 1,
    siteId: "d1",
    occurrence: 1,
    status,
    condition: {
      conditionId: "d1.c0",
      evaluations: [],
      conditionResults: results.map(([conditionId, truth], index) => ({ conditionId, order: index + 1, truth })),
      ...(results.some(([conditionId]) => conditionId === "d1.c0") ? { truth: results.at(-1)![1] } : {})
    },
    ...(status === "completed" ? { outcome: "branch_entered" as const } : {})
  };
}

describe("buildDecisionEvidence", () => {
  it("shows completed AND children as evaluated or short-circuited from ordered truth results", () => {
    const falseEvidence = buildDecisionEvidence(planFor("and"), [batch([["d1.c0.0", false], ["d1.c0", false]])], [runtimeState(1)]);
    expect(falseEvidence.byStep.get(1)?.condition.children[1]).toMatchObject({
      status: "short_circuited",
      skipReason: "and_short_circuit"
    });
    expect(falseEvidence.byStep.get(1)?.condition.children[0]).toMatchObject({ status: "evaluated", truth: false });

    const trueEvidence = buildDecisionEvidence(planFor("and"), [batch([["d1.c0.0", true], ["d1.c0.1", false], ["d1.c0", false]])], [runtimeState(1)]);
    expect(trueEvidence.byStep.get(1)?.condition.children[1]).toMatchObject({ status: "evaluated", truth: false });
  });

  it("shows OR short-circuit only after an evaluated true child", () => {
    const evidence = buildDecisionEvidence(planFor("or"), [batch([["d1.c0.0", true], ["d1.c0", true]])], [runtimeState(1)]);
    expect(evidence.byStep.get(1)?.condition.children[1]).toMatchObject({
      status: "short_circuited",
      skipReason: "or_short_circuit"
    });

    const evaluated = buildDecisionEvidence(planFor("or"), [batch([["d1.c0.0", false], ["d1.c0.1", true], ["d1.c0", true]])], [runtimeState(1)]);
    expect(evaluated.byStep.get(1)?.condition.children[1]).toMatchObject({ status: "evaluated", truth: true });
  });

  it("marks the next required partial child without assigning absent truth or short-circuit state", () => {
    const evidence = buildDecisionEvidence(planFor("and"), [batch([["d1.c0.0", true]], "partial")], [runtimeState(1)]);
    const children = evidence.byStep.get(1)?.condition.children ?? [];
    expect(children[0]).toMatchObject({ status: "evaluated", truth: true });
    expect(children[1]).toMatchObject({ status: "partial" });
    expect(children[1]).not.toHaveProperty("truth");
  });

  it("reconstructs branch chains and keeps raw anchor steps in while history", () => {
    const chainPlan: ConditionPlan = {
      ...planFor(),
      sites: [
        { siteId: "d1", kind: "if", chainId: "chain1", branchIndex: 0, conditionId: "d1.c0", span },
        { siteId: "d2", kind: "elif", chainId: "chain1", branchIndex: 1, conditionId: "d2.c0", span }
      ],
      chains: [{ chainId: "chain1", branches: [
        { branchIndex: 0, kind: "if", siteId: "d1" },
        { branchIndex: 1, kind: "elif", siteId: "d2" },
        { branchIndex: 2, kind: "else" }
      ]}]
    };
    chainPlan.conditions.push({ conditionId: "d2.c0", siteId: "d2", kind: "truth_test", source: "C", span, childConditionIds: [], operandIds: [] });
    const second = { ...batch([["d1.c0", false]]), batchId: 2, anchorStep: 9, siteId: "d1", outcome: "branch_not_entered" as const };
    const third = {
      ...batch([["d2.c0", true]]),
      batchId: 3,
      anchorStep: 12,
      siteId: "d2",
      condition: {
        ...batch([["d2.c0", true]]).condition,
        conditionId: "d2.c0"
      },
      outcome: "branch_entered" as const
    };
    const result = buildDecisionEvidence(chainPlan, [second, third], [runtimeState(9), runtimeState(12)]);

    expect(result.chains[0]).toMatchObject({ selectedBranchIndex: 1 });
    expect(result.chains[0]?.branches.map((branch) => branch.status)).toEqual(["rejected", "selected", "not_reached"]);
    expect(result.historyBySite.get("d1")?.[0]).toMatchObject({ anchorStep: 9 });
    expect(result.historyBySite.get("d2")?.[0]).toMatchObject({ anchorStep: 12 });
  });

  it("returns one decision-chain occurrence per runtime loop context", () => {
    const chainPlan: ConditionPlan = {
      ...planFor(),
      sites: [
        { siteId: "d1", kind: "if", chainId: "chain1", branchIndex: 0, conditionId: "d1.c0", span },
        { siteId: "d2", kind: "elif", chainId: "chain1", branchIndex: 1, conditionId: "d2.c0", span }
      ],
      chains: [{ chainId: "chain1", branches: [
        { branchIndex: 0, kind: "if", siteId: "d1" },
        { branchIndex: 1, kind: "elif", siteId: "d2" },
        { branchIndex: 2, kind: "else" }
      ]}]
    };
    chainPlan.conditions.push({ conditionId: "d2.c0", siteId: "d2", kind: "truth_test", source: "C", span, childConditionIds: [], operandIds: [] });
    const make = (batchId: number, anchorStep: number, context: number, siteId: "d1" | "d2", truth: boolean): DecisionBatch => ({
      batchId,
      anchorStep,
      frameId: 1,
      siteId,
      occurrence: batchId,
      status: "completed",
      context: { loopStack: [{ loopId: "f1", iteration: context }] },
      condition: { conditionId: `${siteId}.c0`, evaluations: [], conditionResults: [{ conditionId: `${siteId}.c0`, order: 1, truth }], truth },
      outcome: truth ? "branch_entered" : "branch_not_entered"
    });
    const batches = [make(1, 1, 1, "d1", true), make(2, 2, 2, "d1", false), make(3, 3, 2, "d2", true), make(4, 4, 3, "d1", false), make(5, 5, 3, "d2", false)];
    const result = buildDecisionEvidence(chainPlan, batches, batches.map((item) => runtimeState(item.anchorStep)));
    expect(result.chains).toHaveLength(3);
    expect(result.chains.map((occurrence) => occurrence.selectedBranchIndex)).toEqual([0, 1, 2]);
    expect(new Set(result.chains.map((occurrence) => occurrence.occurrenceId)).size).toBe(3);
    expect(result.chains.map((occurrence) => occurrence.context.loopStack[0]?.iteration)).toEqual([1, 2, 3]);
  });
});
