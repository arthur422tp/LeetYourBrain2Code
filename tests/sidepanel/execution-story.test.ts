import { describe, expect, it } from "vitest";
import { createExecutionStory } from "../../src/sidepanel/components/ExecutionStory";
import { buildControlFlowUiModel } from "../../src/core/execution-story";
import { storyInput } from "../fixtures/execution-story";

describe("Execution Story", () => {
  it("renders factual stages, captured bindings and activation-local navigation", () => {
    const steps: number[] = [];
    const root = createExecutionStory({ model: buildControlFlowUiModel(storyInput()), onNavigateStep: step => steps.push(step) });
    expect(root.textContent).toContain("FOR · line 2"); expect(root.textContent).toContain("Iteration #2");
    expect(root.textContent).toContain("x = 7"); expect(root.textContent).toContain("x < 0 → False");
    expect(root.textContent).toContain("break · Observed"); expect(root.textContent).toContain("break · Committed");
    expect(root.textContent).toContain("Broke loop"); expect(root.textContent).toContain("Loop exited · break");
    const observed = root.querySelector<HTMLButtonElement>('[data-transfer-phase="observed"]')!;
    expect(observed.tagName).toBe("BUTTON"); observed.click();
    root.querySelector<HTMLButtonElement>('[data-raw-iteration="3"]')!.click();
    expect(steps).toEqual([14, 10]);
    expect(root.querySelector('[data-iteration-status="broke"]')).not.toBeNull();
  });
  it.each([['truncated', 'control_flow_event_limit'], ['unavailable', 'instrumentation_failed']] as const)("retains captured story with %s tracing", (status, reason) => {
    const input = storyInput(); input.tracingState = { status, reason };
    const root = createExecutionStory({ model: buildControlFlowUiModel(input), onNavigateStep: () => { } });
    expect(root.textContent).toContain(`Control-flow tracing ${status} · ${reason}`);
    expect(root.querySelectorAll('[data-raw-iteration]')).toHaveLength(2);
    expect(root.textContent).toContain("break · Committed");
  });
  it("renders a neutral empty state", () => {
    const input = storyInput(); input.step = 99;
    const root = createExecutionStory({ model: buildControlFlowUiModel(input), onNavigateStep: () => { } });
    expect(root.textContent).toBe("No control-flow evidence for this step.");
  });
});

it("keeps incomplete transfer evidence neutral and gives every destination a name", () => {
  const input = storyInput(); input.controlFlow.actions[0]!.status = 'interrupted';
  input.controlFlow.iterations[1]!.status = 'interrupted'; input.controlFlow.loopExits = [];
  const root = createExecutionStory({ model: buildControlFlowUiModel(input), onNavigateStep: () => { } });
  expect(root.textContent).toContain('Control-flow evidence incomplete.');
  expect(root.textContent).toContain('Transfer observed; confirmation unavailable.');
  expect(root.textContent).toContain('Iteration outcome unavailable.');
  expect(root.textContent).toContain('Loop exit evidence unavailable.');
  const buttons = [...root.querySelectorAll('button')];
  expect(buttons.every(button => !!button.getAttribute('aria-label'))).toBe(true);
  expect(new Set(buttons.map(button => button.getAttribute('aria-label'))).size).toBe(buttons.length);
  expect(root.textContent).not.toMatch(/correct branch|wrong branch|root cause|should continue|expected path/i);
});

it("shows None for an observed bare return that committed", () => {
  const input = storyInput(); input.step = 30; input.sourceCode = 'return';
  input.plan!.transfers = [{ transferId: 'r', kind: 'return', span: { line: 1, column: 0, endLine: 1, endColumn: 6 } }];
  input.controlFlow.actions = [{ actionId: 'a', transferId: 'r', kind: 'return', frameId: 1, context: { loopStack: [] }, anchorStepObserved: 29, anchorStepResolved: 30, status: 'committed' }];
  const root = createExecutionStory({ model: buildControlFlowUiModel(input), onNavigateStep: () => { } });
  expect(root.textContent).toContain('return · Committed');
  expect(root.textContent).toContain('Function exited with None');
});
