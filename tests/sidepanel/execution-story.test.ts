import { describe, expect, it } from "vitest";
import { createExecutionStory } from "../../src/sidepanel/components/ExecutionStory";
import { buildControlFlowUiModel } from "../../src/core/execution-story";
import { storyInput } from "../fixtures/execution-story";

describe("Execution Story", () => {
  it("renders factual stages, captured bindings and activation-local navigation", () => {
    const steps: number[]=[];
    const root=createExecutionStory({model:buildControlFlowUiModel(storyInput()),onNavigateStep:step=>steps.push(step)});
    expect(root.textContent).toContain("FOR · line 2"); expect(root.textContent).toContain("Iteration #2");
    expect(root.textContent).toContain("x = 7"); expect(root.textContent).toContain("x < 0 → False");
    expect(root.textContent).toContain("break · Observed"); expect(root.textContent).toContain("break · Committed");
    expect(root.textContent).toContain("Broke loop"); expect(root.textContent).toContain("Loop exited · break");
    const observed=root.querySelector<HTMLButtonElement>('[data-transfer-phase="observed"]')!;
    expect(observed.tagName).toBe("BUTTON"); observed.click();
    root.querySelector<HTMLButtonElement>('[data-raw-iteration="3"]')!.click();
    expect(steps).toEqual([14,10]);
    expect(root.querySelector('[data-iteration-status="broke"]')).not.toBeNull();
  });
  it.each([['truncated','control_flow_event_limit'],['unavailable','instrumentation_failed']] as const)("retains captured story with %s tracing",(status,reason)=>{
    const input=storyInput(); input.tracingState={status,reason};
    const root=createExecutionStory({model:buildControlFlowUiModel(input),onNavigateStep:()=>{}});
    expect(root.textContent).toContain(`Control-flow tracing ${status} · ${reason}`);
    expect(root.querySelectorAll('[data-raw-iteration]')).toHaveLength(2);
    expect(root.textContent).toContain("break · Committed");
  });
  it("renders a neutral empty state",()=>{
    const input=storyInput(); input.step=99;
    const root=createExecutionStory({model:buildControlFlowUiModel(input),onNavigateStep:()=>{}});
    expect(root.textContent).toBe("No control-flow evidence for this step.");
  });
});
