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

function treeModel(currentPath: number[] = [1, 2, 3]): CallFrameStoryModel {
  const root = node(1, "solve", 1, 10, { childFrameIds: [2, 4] });
  const helper = node(2, "helper", 2, 20, { childFrameIds: [3] });
  const nested = node(3, "helper", 3, 30, {
    recursion: { isRecursive: true, recursionDepth: 2, repeatedAncestorFrameId: 2 },
    exit: { status: "returned", step: 35, value: int(4) },
    atCursor: currentPath.includes(3) ? "active" : "exited"
  });
  const sibling = node(4, "sibling", 2, 40, { childFrameIds: [5] });
  const siblingChild = node(5, "sibling", 3, 50, {
    exit: { status: "returned", step: 55, value: int(5) },
    atCursor: currentPath.includes(5) ? "active" : "exited"
  });
  const nodes = [root, helper, nested, sibling, siblingChild].map((item) => [item.frameId, item] as const);
  return {
    roots: [1],
    byFrameId: new Map(nodes),
    currentFrameId: currentPath.at(-1),
    currentPath,
    tracingState: { status: "complete" }
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

  it("renders one nested row per concrete frame in runtime child order", () => {
    const handle = createCallFrameStory({ model: treeModel(), onNavigateStep: () => { } });
    const rows = [...handle.element.querySelectorAll<HTMLElement>(".call-frame-story__tree-row")];

    expect(rows.map((row) => row.dataset.frameId)).toEqual(["1", "2", "3", "4"]);
    expect(handle.element.querySelectorAll(".call-frame-story__tree-list").length).toBeGreaterThan(1);
    expect(handle.element.textContent).toContain("helper() → 4");
    expect(handle.element.textContent).toContain("recursive · depth 2");
    handle.dispose();
  });

  it("navigates frame entry and authoritative exit steps independently", () => {
    const steps: number[] = [];
    const handle = createCallFrameStory({ model: treeModel(), onNavigateStep: (step) => steps.push(step) });
    const row = handle.element.querySelector<HTMLElement>('.call-frame-story__tree-row[data-frame-id="3"]')!;
    row.querySelector<HTMLButtonElement>("[data-frame-action=entry]")!.click();
    row.querySelector<HTMLButtonElement>("[data-frame-action=exit]")!.click();

    expect(steps).toEqual([30, 35]);
    handle.dispose();
  });

  it("preserves user expansion choices across updates while auto-expanding current ancestry", () => {
    const handle = createCallFrameStory({ model: treeModel(), onNavigateStep: () => { } });
    const siblingToggle = handle.element.querySelector<HTMLButtonElement>('[data-frame-toggle="4"]')!;
    expect(siblingToggle.getAttribute("aria-expanded")).toBe("false");
    siblingToggle.click();
    expect(handle.element.querySelector('[data-frame-id="5"]')).not.toBeNull();

    handle.update(treeModel([1, 2, 3]));
    expect(handle.element.querySelector('[data-frame-id="5"]')).not.toBeNull();
    handle.element.querySelector<HTMLButtonElement>('[data-frame-toggle="4"]')!.click();
    handle.update(treeModel([1, 2, 3]));
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="5"]')).toBeNull();

    handle.update(treeModel([1, 4, 5]));
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="5"]')).not.toBeNull();
    expect(handle.element.querySelector<HTMLElement>('.call-frame-story__tree-row[data-frame-id="4"]')?.dataset.currentPath).toBe("true");
    handle.update(treeModel([1, 2, 3]));
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="5"]')).toBeNull();
    handle.dispose();
  });

  it("uses semantic nested lists and exposes current-path state", () => {
    const handle = createCallFrameStory({ model: treeModel(), onNavigateStep: () => { } });
    const toggle = handle.element.querySelector<HTMLButtonElement>('[data-frame-toggle="2"]')!;
    const currentRow = handle.element.querySelector<HTMLElement>('.call-frame-story__tree-row[data-frame-id="3"]')!;

    expect(handle.element.querySelector("ul.call-frame-story__tree-list")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toContain("frame 2");
    expect(currentRow.getAttribute("aria-current")).toBe("step");
    expect(currentRow.dataset.currentFrame).toBe("true");
    expect(currentRow.dataset.currentPath).toBe("true");
    expect(handle.element.querySelector<HTMLElement>('.call-frame-story__tree-row[data-frame-id="2"]')?.dataset.currentPath).toBe("true");
    expect(handle.element.querySelector<HTMLElement>('.call-frame-story__tree-row[data-frame-id="1"]')?.dataset.currentPath).toBe("true");
    handle.dispose();
  });

  it("keeps the whole-run tree suffix separate from current-step temporal copy", () => {
    const handle = createCallFrameStory({ model: model(), onNavigateStep: () => { } });

    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="5"]')?.textContent).toContain("→ 2");
    expect(handle.element.querySelector(".call-frame-story__current")?.textContent).toContain("At this step: active");
    expect(handle.element.querySelector(".call-frame-story__current")?.textContent).toContain("Observed later: returned 2");
    handle.dispose();
  });

  it("bounds large-tree DOM rows while retaining root, current context, and evidence", () => {
    const nodes = Array.from({ length: 300 }, (_, index) => node(
      index + 1,
      "recurse",
      index + 1,
      index + 1,
      { childFrameIds: index < 299 ? [index + 2] : [] }
    ));
    const largeModel: CallFrameStoryModel = {
      roots: [1],
      byFrameId: new Map(nodes.map((item) => [item.frameId, item])),
      currentFrameId: 250,
      currentPath: Array.from({ length: 250 }, (_, index) => index + 1),
      tracingState: { status: "complete" }
    };
    const handle = createCallFrameStory({ model: largeModel, onNavigateStep: () => { } });
    const rows = () => [...handle.element.querySelectorAll<HTMLElement>(".call-frame-story__tree-row")];

    expect(largeModel.byFrameId.size).toBe(300);
    expect(rows().length).toBeLessThanOrEqual(120);
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="1"]')).not.toBeNull();
    expect(handle.element.querySelector('.call-frame-story__tree-row[data-frame-id="250"]')).not.toBeNull();
    expect(handle.element.querySelector('[data-tree-summary]')?.textContent).toContain("additional recorded frames");
    const before = rows().length;
    handle.element.querySelector<HTMLButtonElement>('[data-action="show-more"]')!.click();
    expect(rows().length).toBeGreaterThan(before);
    expect(rows().length).toBeLessThanOrEqual(220);
    handle.dispose();
  });
});
