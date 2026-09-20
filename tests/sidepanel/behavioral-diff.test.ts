import { describe, expect, it, vi } from "vitest";

import {
  createBehavioralDiff,
  type BehavioralDiffViewModel
} from "../../src/sidepanel/components/BehavioralDiff";

function model(overrides: Partial<BehavioralDiffViewModel> = {}): BehavioralDiffViewModel {
  return {
    summary: "First observed divergence: Decision result changed",
    compatibility: { status: "compatible" },
    sourceDiffers: true,
    baselineLabel: "Baseline · Case 1",
    currentLabel: "Current · Case 1",
    matchedPrefix: { frames: 2, checkpoints: 4, callPath: ["solve", "search"] },
    divergence: {
      categoryLabel: "Decision result changed",
      locationLabel: "search · decision",
      baseline: { factualText: "decision truth = false", step: 18 },
      current: { factualText: "decision truth = true", step: 21 },
      currentStep: 21,
      confidence: "strong"
    },
    ...overrides
  };
}

describe("BehavioralDiff", () => {
  it("renders semantic baseline/current sections and a real current inspect button", () => {
    const onInspectCurrent = vi.fn();
    const handle = createBehavioralDiff({ model: model(), onInspectCurrent });

    expect(handle.element.querySelector("h2")?.textContent).toBe("Behavioral Diff");
    expect(handle.element.querySelectorAll("h3").length).toBeGreaterThanOrEqual(2);
    expect(handle.element.textContent).toContain("Baseline · Case 1");
    expect(handle.element.textContent).toContain("Current · Case 1");
    expect(handle.element.textContent).toContain("Matched before divergence");
    expect(handle.element.querySelector<HTMLButtonElement>("#behavioral-diff-inspect-current")?.type)
      .toBe("button");

    handle.element.querySelector<HTMLButtonElement>("#behavioral-diff-inspect-current")?.click();
    expect(onInspectCurrent).toHaveBeenCalledWith(21);
    expect(handle.element.className).not.toMatch(/green|red/);
    expect(handle.element.textContent?.toLowerCase()).not.toMatch(/wrong|correct|root cause|fix|expected/);
  });

  it("keeps the persistent root while hiding an unavailable comparison", () => {
    const handle = createBehavioralDiff({ model: model(), onInspectCurrent: vi.fn() });
    const element = handle.element;

    handle.update(null);

    expect(handle.element).toBe(element);
    expect(element.hidden).toBe(true);
    expect(element.querySelector("#behavioral-diff-inspect-current")).toBeNull();
  });
});
