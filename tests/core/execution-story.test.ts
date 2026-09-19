import { describe, expect, it } from "vitest";
import { buildControlFlowUiModel, type BuildControlFlowUiModelInput } from "../../src/core/execution-story";
import { buildControlFlowEvidence } from "../../src/core/control-flow-interpreter";
import type { LoopIterationEvidence } from "../../src/shared/control-flow-types";

import { storyInput } from "../fixtures/execution-story";

describe("execution story projection", () => {
  it("uses activation-local ordinals while preserving worker numbers and factual ordering", () => {
    const model = buildControlFlowUiModel(storyInput());
    expect(model.currentActivation?.activationKey).toBe("1:f1#2>f2");
    expect(model.iterationHistory.map(i => i.ordinal)).toEqual([1, 2]);
    expect(model.iterationHistory.map(i => i.iteration.iteration)).toEqual([3, 4]);
    expect(model.currentIteration?.ordinal).toBe(2);
    expect(model.storyItems.map(i => [i.kind, i.anchorStep])).toEqual([["iteration_start", 13], ["decision", 13], ["transfer", 14], ["transfer", 15], ["iteration_outcome", 15], ["loop_exit", 16]]);
    expect(model.storyItems.filter(i => i.kind === "transfer").map(i => [i.source, i.phase])).toEqual([["break", "observed"], ["break", "committed"]]);
  });
  it("selects an exact exit even after active context is empty", () => {
    const input = storyInput(); input.step = 16; input.controlFlow.contextByStep.set(16, { loopStack: [] });
    input.controlFlow.loopExits[0]!.reason = "exhausted";
    expect(buildControlFlowUiModel(input).currentLoopExit?.reason).toBe("exhausted");
    expect(buildControlFlowUiModel(input).currentIteration?.ordinal).toBe(2);
  });
  it("does not fabricate a zero-iteration occurrence or reuse a previous parent activation", () => {
    const input = storyInput(); input.step = 20;
    input.controlFlow.loopExits.push({ frameId: 1, loopId: "f2", loopKind: "for", context: { loopStack: [{ loopId: "f1", iteration: 3 }] }, anchorStep: 20, reason: "exhausted" });
    const model = buildControlFlowUiModel(input);
    expect(model.currentIteration).toBeUndefined(); expect(model.iterationHistory).toEqual([]);
    expect(model.storyItems.map(i => i.kind)).toEqual(["loop_exit"]);
  });
  it("does not mix decisions and actions from another occurrence or frame", () => {
    const input = storyInput(); input.decisionEvidence.get(13)!.context = { loopStack: [{ loopId: "f1", iteration: 1 }, { loopId: "f2", iteration: 2 }] }; input.controlFlow.actions[0]!.frameId = 2;
    expect(buildControlFlowUiModel(input).storyItems.map(i => i.kind)).toEqual(["iteration_start", "iteration_outcome", "loop_exit"]);
  });
  it("selects a chain only inside its current occurrence range", () => {
    const input = storyInput(); input.decisionChains = [{ chainId: "chain1", occurrenceId: "occ1", frameId: 1, context: input.decisionEvidence.get(13)!.context, anchorStepStart: 13, anchorStepEnd: 14, branches: [], selectedBranchIndex: null }];
    expect(buildControlFlowUiModel(input).decisionChainOccurrence?.occurrenceId).toBe("occ1");
    input.step = 15; input.controlFlow.contextByStep.set(15, input.decisionChains[0]!.context);
    expect(buildControlFlowUiModel(input).decisionChainOccurrence).toBeUndefined();
  });
  it("projects committed returns outside loops and retains superseded observations", () => {
    const input = storyInput(); input.step = 30; input.controlFlow.actions = [
      { actionId: "r1", transferId: "r1", kind: "return", frameId: 1, context: { loopStack: [] }, anchorStepObserved: 28, anchorStepResolved: 30, status: "superseded", supersededByActionId: "r2" },
      { actionId: "r2", transferId: "r2", kind: "return", frameId: 1, context: { loopStack: [] }, anchorStepObserved: 29, anchorStepResolved: 30, status: "committed" }];
    const items = buildControlFlowUiModel(input).storyItems;
    expect(items.filter(i => i.kind === "transfer").map(i => i.phase)).toEqual(["observed", "observed", "superseded", "committed"]);
    expect(items.at(-1)).toMatchObject({ kind: "frame_exit", anchorStep: 30, actionId: "r2" });
  });
});

it("keeps outline groups separate by parent with fresh local ordinals", async () => {
  const { buildControlFlowOutlineGroups } = await import('../../src/core/execution-story');
  const input = storyInput(); const earlier = { ...input.controlFlow.iterations[0]!, iteration: 1, anchorStepStart: 1, anchorStepEnd: 2 };
  input.controlFlow.iterationsByActivation.set('1:f1#1>f2', [earlier]);
  const groups = buildControlFlowOutlineGroups(input.plan, input.controlFlow);
  expect(groups.map(group => group.activationKey)).toEqual(['1:f1#1>f2', '1:f1#2>f2']);
  expect(groups.map(group => group.iterations.map(item => [item.ordinal, item.rawIteration]))).toEqual([[[1, 1]], [[1, 3], [2, 4]]]);
});

it("does not include adjacent occurrence evidence sharing the resolution anchor", () => {
  const input = storyInput(); input.step = 12;
  const first = input.controlFlow.iterations[0]!; input.controlFlow.contextByStep.set(12, first.context);
  input.decisionEvidence.get(13)!.anchorStep = 12;
  input.controlFlow.actions[0]!.anchorStepObserved = 12;
  const model = buildControlFlowUiModel(input);
  expect(model.currentIteration?.ordinal).toBe(1);
  expect(model.storyItems.some(item => item.kind === 'decision' || item.kind === 'transfer')).toBe(false);
});

it("does not borrow another frame's active loop context", () => {
  const input = storyInput(); input.frameId = 2;
  const model = buildControlFlowUiModel(input);
  expect(model.currentActivation).toBeUndefined(); expect(model.storyItems).toEqual([]);
});

it("does not claim None when the return source span is unavailable", () => {
  const input = storyInput(); input.step = 30; input.sourceCode = '';
  input.plan!.transfers = [{ transferId: 'r', kind: 'return', span: { line: 1, column: 0, endLine: 1, endColumn: 6 } }];
  input.controlFlow.actions = [{ actionId: 'a', transferId: 'r', kind: 'return', frameId: 1, context: { loopStack: [] }, anchorStepObserved: 29, anchorStepResolved: 30, status: 'committed' }];
  expect(buildControlFlowUiModel(input).storyItems.find(item => item.kind === 'frame_exit')).not.toMatchObject({ bareReturn: true });
});
