import { describe, expect, it } from "vitest";
import { createExecutionStory } from "../../src/sidepanel/components/ExecutionStory";
import { buildControlFlowUiModel } from "../../src/core/execution-story";
import { storyInput } from "../fixtures/execution-story";
import type { CallFrameStoryModel } from "../../src/core/call-frame-story";

function callFrameStoryModel(): CallFrameStoryModel {
  return {
    roots: [1],
    byFrameId: new Map([[1, {
      frameId: 1,
      functionName: "solve",
      qualifiedName: "Solution.solve",
      displayName: "Solution.solve",
      depth: 1,
      arguments: [],
      callStep: 1,
      exit: { status: "active" },
      atCursor: "active",
      recursion: { isRecursive: false, recursionDepth: 1 },
      childFrameIds: [],
      evidenceCounts: { decisions: 0, loopIterations: 0, expressions: 0, mutations: 0 }
    }]]),
    currentFrameId: 1,
    currentPath: [1],
    tracingState: { status: "complete" }
  };
}

describe("Execution Story", () => {
  it("retains keyboard focus in the frame story when the composed model updates", () => {
    const callFrame = callFrameStoryModel();
    const handle = createExecutionStory({ model: { callFrame }, onNavigateStep: () => {} });
    document.body.append(handle.element);
    handle.element.querySelector<HTMLButtonElement>('.call-frame-story__path-segment')!.focus();
    handle.update({ callFrame });
    expect(document.activeElement).toBe(handle.element.querySelector('.call-frame-story__path-segment'));
    handle.dispose();
    handle.element.remove();
  });
  it("renders factual stages, captured bindings and activation-local navigation", () => {
    const steps: number[] = [];
    const handle = createExecutionStory({ model: { controlFlow: buildControlFlowUiModel(storyInput()) }, onNavigateStep: step => steps.push(step) });
    expect(handle.element.textContent).toContain("FOR · line 2"); expect(handle.element.textContent).toContain("Iteration #2");
    expect(handle.element.textContent).toContain("FOR · line 1 · iteration #2");
    expect(handle.element.textContent).not.toContain("f1 · iteration #2");
    expect(handle.element.textContent).toContain("x = 7"); expect(handle.element.textContent).toContain("x < 0 → False");
    expect(handle.element.textContent).toContain("break · Observed"); expect(handle.element.textContent).toContain("break · Committed");
    expect(handle.element.textContent).toContain("Broke loop"); expect(handle.element.textContent).toContain("Loop exited · break");
    const observed = handle.element.querySelector<HTMLButtonElement>('[data-transfer-phase="observed"]')!;
    expect(observed.tagName).toBe("BUTTON"); observed.click();
    handle.element.querySelector<HTMLButtonElement>('[data-raw-iteration="3"]')!.click();
    expect(steps).toEqual([14, 10]);
    expect(handle.element.querySelector('[data-iteration-status="broke"]')).not.toBeNull();
    handle.dispose();
  });
  it.each([['truncated', 'control_flow_event_limit'], ['unavailable', 'instrumentation_failed']] as const)("retains captured story with %s tracing", (status, reason) => {
    const input = storyInput(); input.tracingState = { status, reason };
    const handle = createExecutionStory({ model: { controlFlow: buildControlFlowUiModel(input) }, onNavigateStep: () => { } });
    expect(handle.element.textContent).toContain(`Control-flow tracing ${status} · ${reason}`);
    expect(handle.element.querySelectorAll('[data-raw-iteration]')).toHaveLength(2);
    expect(handle.element.textContent).toContain("break · Committed");
    handle.dispose();
  });
  it("renders a neutral empty state", () => {
    const input = storyInput(); input.step = 99;
    const handle = createExecutionStory({ model: { controlFlow: buildControlFlowUiModel(input) }, onNavigateStep: () => { } });
    expect(handle.element.textContent).toBe("No control-flow evidence for this step.");
    handle.dispose();
  });
});

it("keeps incomplete transfer evidence neutral and gives every destination a name", () => {
  const input = storyInput(); input.controlFlow.actions[0]!.status = 'interrupted';
  input.controlFlow.iterations[1]!.status = 'interrupted'; input.controlFlow.loopExits = [];
  const handle = createExecutionStory({ model: { controlFlow: buildControlFlowUiModel(input) }, onNavigateStep: () => { } });
  expect(handle.element.textContent).toContain('Control-flow evidence incomplete.');
  expect(handle.element.textContent).toContain('Transfer observed; confirmation unavailable.');
  expect(handle.element.textContent).toContain('Iteration outcome unavailable.');
  expect(handle.element.textContent).toContain('Loop exit evidence unavailable.');
  const buttons = [...handle.element.querySelectorAll('button')];
  expect(buttons.every(button => !!button.getAttribute('aria-label'))).toBe(true);
  expect(new Set(buttons.map(button => button.getAttribute('aria-label'))).size).toBe(buttons.length);
  expect(handle.element.textContent).not.toMatch(/correct branch|wrong branch|root cause|should continue|expected path/i);
  handle.dispose();
});

it("shows None for an observed bare return that committed", () => {
  const input = storyInput(); input.step = 30; input.sourceCode = 'return';
  input.plan!.transfers = [{ transferId: 'r', kind: 'return', span: { line: 1, column: 0, endLine: 1, endColumn: 6 } }];
  input.controlFlow.actions = [{ actionId: 'a', transferId: 'r', kind: 'return', frameId: 1, context: { loopStack: [] }, anchorStepObserved: 29, anchorStepResolved: 30, status: 'committed' }];
  const handle = createExecutionStory({ model: { controlFlow: buildControlFlowUiModel(input) }, onNavigateStep: () => { } });
  expect(handle.element.textContent).toContain('return · Committed');
  expect(handle.element.textContent).toContain('Function exited with None');
  handle.dispose();
});

it("composes frame story above control-flow and reuses it on update", () => {
  const controlFlow = buildControlFlowUiModel(storyInput());
  const handle = createExecutionStory({
    model: { callFrame: callFrameStoryModel(), controlFlow },
    onNavigateStep: () => { }
  });
  const frameRoot = handle.element.querySelector(".call-frame-story");

  expect(frameRoot).not.toBeNull();
  expect(handle.element.querySelector(".execution-story__control-flow")).not.toBeNull();
  expect(handle.element.textContent).toContain("Inside this frame");
  expect(frameRoot?.compareDocumentPosition(handle.element.querySelector(".execution-story__control-flow")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

  handle.update({ callFrame: callFrameStoryModel(), controlFlow });
  expect(handle.element.querySelector(".call-frame-story")).toBe(frameRoot);
  handle.dispose();
});
