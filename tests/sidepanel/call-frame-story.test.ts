import { describe, expect, it } from "vitest";

import { createCallFrameStory } from "../../src/sidepanel/components/CallFrameStory";
import type { CallFrameStoryModel, CallFrameStoryNode } from "../../src/core/call-frame-story";
import type { ValueSnapshot } from "../../src/shared/trace-types";

const int = (value: number): ValueSnapshot => ({ type: "int", value: String(value) });

function node(
  frameId: number,
  displayName: string,
  depth: number,
  callStep: number,
  overrides: Partial<CallFrameStoryNode> = {}
): CallFrameStoryNode {
  return {
    frameId,
    functionName: displayName.split(".").at(-1) ?? displayName,
    qualifiedName: displayName,
    displayName,
    depth,
    arguments: [],
    callStep,
    exit: { status: "active" },
    atCursor: "active",
    recursion: { isRecursive: false, recursionDepth: 1 },
    childFrameIds: [],
    evidenceCounts: { decisions: 0, loopIterations: 0, expressions: 0, mutations: 0 },
    ...overrides
  };
}

function model(overrides: Partial<CallFrameStoryModel> = {}): CallFrameStoryModel {
  const root = node(1, "Solution.solve", 1, 10, { childFrameIds: [5] });
  const current = node(5, "Solution.maxDepth", 2, 20, {
    functionId: "method:Solution.maxDepth",
    arguments: [{ name: "self", kind: "positional_or_keyword", value: int(99) }, { name: "root", kind: "positional_or_keyword", value: int(20) }],
    exit: { status: "returned", step: 80, value: int(2) },
    recursion: { isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 1 },
    atCursor: "active"
  });
  return {
    roots: [1],
    byFrameId: new Map([[1, root], [5, current]]),
    currentFrameId: 5,
    currentPath: [1, 5],
    tracingState: { status: "complete" },
    ...overrides
  };
}

describe("CallFrameStory", () => {
  it("renders Current Frame with factual temporal and depth context", () => {
    const handle = createCallFrameStory({ model: model(), onNavigateStep: () => { } });

    expect(handle.element.textContent).toContain("Current frame");
    expect(handle.element.textContent).toContain("maxDepth(root=20)");
    expect(handle.element.textContent).toContain("Frame 5");
    expect(handle.element.textContent).toContain("depth 2");
    expect(handle.element.textContent).toContain("recursive depth 2");
    expect(handle.element.textContent).toContain("At this step: active");
    expect(handle.element.textContent).toContain("Observed later: returned 2");

    const current = handle.element.querySelector<HTMLElement>('[data-current-frame="true"]')!;
    expect(current.dataset.frameId).toBe("5");
    expect(current.dataset.functionId).toBe("method:Solution.maxDepth");
    expect(current.dataset.frameDepth).toBe("2");
    expect(current.dataset.recursionDepth).toBe("2");
    expect(current.dataset.frameExitStatus).toBe("returned");
    expect(current.dataset.callStep).toBe("20");
    expect(current.textContent).not.toContain("self=");
    handle.dispose();
  });

  it.each([
    ["active", "At this step: active", "Observed later: returned 2"],
    ["exited", "At this step: exited", "Session outcome: Returned 2"],
    ["not_started", "Not entered at this step", "Observed later: returned 2"]
  ] as const)("renders %s separately from the final outcome", (status, expected, outcome) => {
    const handle = createCallFrameStory({
      model: model({
        byFrameId: new Map([[5, node(5, "helper", 2, 20, {
          exit: { status: "returned", step: 80, value: int(2) },
          atCursor: status
        })]]),
        currentFrameId: 5,
        currentPath: [5]
      }),
      onNavigateStep: () => { }
    });

    expect(handle.element.textContent).toContain(expected);
    expect(handle.element.textContent).toContain(outcome);
    handle.dispose();
  });

  it("renders and navigates a factual root-to-current call path", () => {
    const steps: number[] = [];
    const handle = createCallFrameStory({ model: model(), onNavigateStep: (step) => steps.push(step) });
    const path = [...handle.element.querySelectorAll<HTMLButtonElement>(".call-frame-story__path-segment")];

    expect(path.map((button) => button.dataset.frameId)).toEqual(["1", "5"]);
    expect(path.map((button) => button.dataset.callStep)).toEqual(["10", "20"]);
    expect(path[1]!.getAttribute("aria-current")).toBe("step");
    expect(path[1]!.dataset.currentFrame).toBe("true");
    path[0]!.click();
    path[1]!.click();
    expect(steps).toEqual([10, 20]);
    handle.dispose();
  });

  it("compacts the middle of a deep path without changing factual endpoints", () => {
    const nodes = Array.from({ length: 10 }, (_, index) => node(index + 1, `f${index + 1}`, index + 1, index + 1));
    const handle = createCallFrameStory({
      model: {
        roots: [1],
        byFrameId: new Map(nodes.map((item) => [item.frameId, item])),
        currentFrameId: 10,
        currentPath: nodes.map((item) => item.frameId),
        tracingState: { status: "complete" }
      },
      onNavigateStep: () => { }
    });
    const path = [...handle.element.querySelectorAll<HTMLButtonElement>(".call-frame-story__path-segment")];

    expect(path.map((button) => button.dataset.frameId)).toEqual(["1", "2", "9", "10"]);
    expect(handle.element.textContent).toContain("6 frames");
    handle.dispose();
  });

  it("keeps the captured current frame and path visible with incomplete tracing", () => {
    const handle = createCallFrameStory({
      model: model({ tracingState: { status: "truncated", reason: "call_frame_event_limit" } }),
      onNavigateStep: () => { }
    });

    expect(handle.element.textContent).toContain("Call-frame tracing truncated · call_frame_event_limit");
    expect(handle.element.textContent).toContain("Current frame");
    expect(handle.element.textContent).toContain("maxDepth(root=20)");
    handle.update(model({ tracingState: { status: "unavailable", reason: "instrumentation_failed" } }));
    expect(handle.element.textContent).toContain("Call-frame tracing unavailable · instrumentation_failed");
    handle.dispose();
  });

  it("updates in place while preserving the persistent root element", () => {
    const handle = createCallFrameStory({ model: model(), onNavigateStep: () => { } });
    const root = handle.element;
    handle.update(model({
      byFrameId: new Map([[5, node(5, "helper", 2, 20, { atCursor: "exited", exit: { status: "returned", step: 80, value: int(2) } })]]),
      currentFrameId: 5,
      currentPath: [5]
    }));

    expect(handle.element).toBe(root);
    expect(handle.element.textContent).toContain("At this step: exited");
    handle.dispose();
  });
});
