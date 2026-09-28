import { describe, expect, it, vi } from "vitest";

import {
  createCaseBehavioralDiff,
  type CaseBehavioralDiffModel
} from "../../src/sidepanel/components/CaseBehavioralDiff";

function model(overrides: Partial<CaseBehavioralDiffModel> = {}): CaseBehavioralDiffModel {
  return {
    leftCaseIndex: 0,
    rightCaseIndex: 2,
    compatibility: { status: "compatible" },
    presentation: {
      category: "decision",
      title: "Decision differs",
      left: { caseLabel: "Case 1", factualText: "condition → false", step: 8 },
      right: { caseLabel: "Case 3", factualText: "condition → true", step: 13 },
      confidence: "strong"
    },
    leftAnchorAuthoritative: true,
    rightAnchorAuthoritative: true,
    ...overrides
  };
}

describe("CaseBehavioralDiff", () => {
  it("renders a factual first-divergence card with the evidence disclaimer", () => {
    const handle = createCaseBehavioralDiff({
      model: model(),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });

    expect(handle.element.querySelector("h2")?.textContent).toBe("Case comparison");
    expect(handle.element.textContent).toContain("Case 1 vs Case 3");
    expect(handle.element.textContent).toContain("First observed divergence");
    expect(handle.element.textContent).toContain("Decision differs");
    expect(handle.element.textContent).toContain("Case 1: condition → false");
    expect(handle.element.textContent).toContain("Case 3: condition → true");
    expect(handle.element.textContent).toContain(
      "Differences describe captured runtime behavior. They do not identify the correct path or root cause."
    );
    handle.dispose();
  });

  it("shows explicit no-divergence copy without implying equivalence", () => {
    const handle = createCaseBehavioralDiff({
      model: model({ presentation: undefined }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });

    expect(handle.element.textContent).toContain("No behavioral difference was found in the captured evidence.");
    expect(handle.element.textContent).not.toContain("equivalent");
    expect(handle.element.querySelector("#case-behavioral-diff-inspect-left")).toBeNull();
    handle.dispose();
  });

  it("surfaces partial coverage as a bounded evidence note", () => {
    const handle = createCaseBehavioralDiff({
      model: model({
        presentation: undefined,
        coverageMessage: "Decision evidence is partial."
      }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });

    expect(handle.element.textContent).toContain("Decision evidence is partial.");
    handle.dispose();
  });

  it("shows stopped alignment without rendering an inspectable divergence", () => {
    const handle = createCaseBehavioralDiff({
      model: model({
        presentation: undefined,
        stopReason: "ambiguous_alignment"
      }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });

    expect(handle.element.textContent).toContain("could not be aligned safely");
    expect(handle.element.querySelector("#case-behavioral-diff-inspect-left")).toBeNull();
    expect(handle.element.querySelector("#case-behavioral-diff-inspect-right")).toBeNull();
    handle.dispose();
  });

  it("renders actionable states for missing sides and incompatible pairs", () => {
    const handle = createCaseBehavioralDiff({
      model: { leftCaseIndex: null, rightCaseIndex: null },
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });
    expect(handle.element.textContent).toContain("No Case A selected.");

    handle.update({ leftCaseIndex: 0, rightCaseIndex: null });
    expect(handle.element.textContent).toContain("No Case B selected.");

    handle.update(model({
      presentation: undefined,
      compatibility: { status: "same_case" }
    }));
    expect(handle.element.textContent).toContain("Select a different Case before comparing.");

    handle.update(model({
      presentation: undefined,
      compatibility: { status: "different_source" }
    }));
    expect(handle.element.textContent).toContain("Run both Cases again with the same code.");

    handle.update(model({
      presentation: undefined,
      compatibility: { status: "different_problem" }
    }));
    expect(handle.element.textContent).toContain("same problem");

    handle.update(model({
      presentation: undefined,
      compatibility: { status: "unsupported_runtime" }
    }));
    expect(handle.element.textContent).toContain("unavailable for comparison");
    handle.dispose();
  });

  it("does not introduce correctness labels beyond the required evidence disclaimer", () => {
    const handle = createCaseBehavioralDiff({
      model: model(),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });

    expect(handle.element.textContent?.toLowerCase()).not.toMatch(/wrong|bug|fix|should/);
    handle.dispose();
  });

  it("enables Inspect only for authoritative anchor steps", () => {
    const onInspectLeft = vi.fn();
    const onInspectRight = vi.fn();
    const handle = createCaseBehavioralDiff({
      model: model({ rightAnchorAuthoritative: false }),
      onInspectLeft,
      onInspectRight
    });

    const left = handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-inspect-left")!;
    const right = handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-inspect-right")!;
    expect(left.disabled).toBe(false);
    expect(right.disabled).toBe(true);
    expect(left.type).toBe("button");
    expect(right.type).toBe("button");
    left.click();
    right.click();
    expect(onInspectLeft).toHaveBeenCalledWith(8);
    expect(onInspectRight).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("offers a return-to-current action while inspecting a captured side", () => {
    const onReturnToCurrent = vi.fn();
    const handle = createCaseBehavioralDiff({
      model: model({ displayMode: "left" }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn(),
      onReturnToCurrent
    });

    const button = handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-return-current");
    expect(button).not.toBeNull();
    button!.click();
    expect(onReturnToCurrent).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
});
