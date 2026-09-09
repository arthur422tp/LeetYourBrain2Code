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

const multipleFoldModel: TraceFoldModel = {
  foldedPatternIds: ["p", "q"],
  segments: [
    ...model.segments,
    {
      kind: "repeated_transition_fold", segmentId: "fold:q", patternId: "q",
      startIndex: 10, endIndex: 12, periodSteps: 1, repeatCount: 3,
      iterations: [
        { iteration: 1, startIndex: 10, endIndex: 10 },
        { iteration: 2, startIndex: 11, endIndex: 11 },
        { iteration: 3, startIndex: 12, endIndex: 12 }
      ]
    }
  ]
};

describe("TraceOutline", () => {
  it("names each fold toggle with its distinct raw display range", () => {
    const handle = createTraceOutline({ model: multipleFoldModel, currentIndex: 0, onNavigate: vi.fn() });
    const toggles = [...handle.element.querySelectorAll<HTMLButtonElement>('[data-outline-action="toggle"]')];

    expect(toggles.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Toggle motif repetitions · Steps 3–8",
      "Toggle motif repetitions · Steps 11–13"
    ]);
  });

  it("names repetition Inspect destinations distinctly across folds and raw rows", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model: multipleFoldModel, currentIndex: 0, onNavigate });
    handle.element.querySelectorAll<HTMLButtonElement>('[data-outline-action="toggle"]')
      .forEach((button) => button.click());
    const buttons = [...handle.element.querySelectorAll<HTMLButtonElement>('[data-outline-action="inspect"]')];
    const names = buttons.map((button) => button.getAttribute("aria-label"));

    expect(names).toEqual([
      "Inspect Steps 1–2", "Inspect Steps 3–8",
      "Inspect motif repetition 1 · Steps 3–4",
      "Inspect motif repetition 2 · Steps 5–6",
      "Inspect motif repetition 3 · Steps 7–8",
      "Inspect Steps 9–10", "Inspect Steps 11–13",
      "Inspect motif repetition 1 · Step 11",
      "Inspect motif repetition 2 · Step 12",
      "Inspect motif repetition 3 · Step 13"
    ]);
    expect(new Set(names).size).toBe(buttons.length);
    buttons.forEach((button) => button.click());
    expect(onNavigate.mock.calls.map(([index]) => index)).toEqual([0, 2, 2, 4, 6, 8, 10, 10, 11, 12]);
  });

  it("starts folds collapsed", () => {
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate: vi.fn() });
    const fold = handle.element.querySelector('[data-segment-id="fold:p"]')!;
    expect(fold.textContent).toContain("Repeated 2-step behavior × 3");
    expect(fold.textContent).toContain("Steps 3–8");
    expect(fold.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
    expect(fold.querySelector('[data-outline-action="toggle"]')?.getAttribute("aria-expanded"))
      .toBe("false");
  });

  it("expands, collapses, and reopens motif repetitions without navigating", () => {
    const onNavigate = vi.fn();
    const handle = createTraceOutline({ model, currentIndex: 0, onNavigate });
    const toggle = handle.element.querySelector<HTMLButtonElement>('[data-outline-action="toggle"]')!;
    toggle.click();

    expect(onNavigate).not.toHaveBeenCalled();
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(handle.element.textContent).toContain("Motif repetition 2 · Steps 5–6");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    toggle.click();
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(0);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(onNavigate).not.toHaveBeenCalled();

    handle.setCurrentIndex(5);
    toggle.click();
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration")).toHaveLength(3);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(handle.element.querySelectorAll(".trace-viewer__outline-iteration.is-active")).toHaveLength(1);
    expect(handle.element.querySelector(".trace-viewer__outline-iteration.is-active")?.getAttribute("data-iteration"))
      .toBe("2");
    expect(onNavigate).not.toHaveBeenCalled();
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
