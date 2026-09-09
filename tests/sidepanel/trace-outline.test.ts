import { describe, expect, it, vi } from "vitest";
import type { TraceFoldModel } from "../../src/sidepanel/trace-folding";
import { createTraceOutline } from "../../src/sidepanel/components/TraceOutline";

const model: TraceFoldModel = {
  foldedPatternIds: ["p"],
  segments: [
    { kind: "raw_range", segmentId: "raw:0:1", startIndex: 0, endIndex: 1 },
    {
      kind: "repeated_transition_fold",
      segmentId: "fold:p",
      patternId: "p",
      startIndex: 2,
      endIndex: 7,
      periodSteps: 2,
      repeatCount: 3,
      iterations: [
        { iteration: 1, startIndex: 2, endIndex: 3 },
        { iteration: 2, startIndex: 4, endIndex: 5 },
        { iteration: 3, startIndex: 6, endIndex: 7 }
      ]
    },
    { kind: "raw_range", segmentId: "raw:8:9", startIndex: 8, endIndex: 9 }
  ]
};

describe("TraceOutline", () => {
  it("starts folds collapsed", () => {
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
    const fold = handle.element.querySelector('[data-segment-id="fold:p"]')!;
    expect(fold.textContent).toContain("Repeated 2-step behavior × 3");
    expect(fold.textContent).toContain("Steps 3–8");
    expect(fold.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
    expect(fold.querySelector('[data-outline-action="toggle"]')?.getAttribute("aria-expanded"))
      .toBe("false");
  });

  it("expands into motif repetitions without navigating", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
    const toggle = handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!;
    toggle.click();

    expect(onNavigate).not.toHaveBeenCalled();
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(handle.element.textContent).toContain("Motif repetition 2 · Steps 5–6");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("navigates ranges, folds, and repetitions to raw indexes", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
    handle.element.querySelector<HTMLButtonElement>('[data-segment-id="raw:0:1"] [data-outline-action="inspect"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-segment-id="fold:p"] [data-outline-action="inspect"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!.click();
    handle.element.querySelector<HTMLButtonElement>('[data-iteration="2"] [data-outline-action="inspect"]')!.click();

    expect(onNavigate.mock.calls.map(([index]) => index)).toEqual([0, 2, 4]);
  });

  it("preserves expansion while currentIndex changes", () => {
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
    handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!.click();
    handle.setCurrentIndex(5);

    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(handle.element.querySelector('[data-segment-id="fold:p"]')?.classList.contains("is-active"))
      .toBe(true);
    expect(handle.element.querySelector('[data-iteration="2"]')?.classList.contains("is-active"))
      .toBe(true);
  });

  it("marks exactly one owning segment current", () => {
    const handle = createTraceOutline({ model, currentIndex: 9, onNavigate: vi.fn() });
    expect(handle.element.querySelectorAll(".trace-viewer__outline-segment.is-active")).toHaveLength(1);
    expect(handle.element.querySelector('[data-segment-id="raw:8:9"]')?.getAttribute("aria-current"))
      .toBe("step");
  });

  it("renders an empty neutral state", () => {
    const handle = createTraceOutline({
      model: { segments: [], foldedPatternIds: [] },
      currentIndex: 0,
      onNavigate: vi.fn()
    });
    expect(handle.element.textContent).toContain("No execution steps were captured.");
    expect(handle.element.querySelector("button")).toBeNull();
  });
});
