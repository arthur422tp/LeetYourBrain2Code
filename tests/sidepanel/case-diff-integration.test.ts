import { describe, expect, it, vi } from "vitest";

import type { CrossRunDivergence, CrossRunDivergenceKind } from "../../src/core/cross-run-diff";
import { buildCaseDivergencePresentation } from "../../src/sidepanel/case-diff-presentation";
import {
  createCaseBehavioralDiff,
  type CaseBehavioralDiffModel
} from "../../src/sidepanel/components/CaseBehavioralDiff";

function divergence(
  kind: CrossRunDivergenceKind,
  confidence: "strong" | "fallback" = "strong"
): CrossRunDivergence {
  return {
    kind,
    alignmentConfidence: confidence,
    baseline: { frameKey: "solve", step: 8, factualText: "left observed" },
    current: { frameKey: "solve", step: 13, factualText: "right observed" }
  };
}

function model(overrides: Partial<CaseBehavioralDiffModel> = {}): CaseBehavioralDiffModel {
  return {
    leftCaseIndex: 0,
    rightCaseIndex: 2,
    compatibility: { status: "compatible" },
    presentation: buildCaseDivergencePresentation(divergence("decision_truth_changed"), 0, 2),
    leftAnchorAuthoritative: true,
    rightAnchorAuthoritative: true,
    ...overrides
  };
}

describe("case behavioral diff integration", () => {
  it.each([
    ["decision_truth_changed", "Decision differs"],
    ["mutation_value_changed", "State change differs"],
    ["child_call_extra", "Call behavior differs"],
    ["iteration_status_changed", "Control flow differs"],
    ["expression_value_changed", "Expression differs"],
    ["return_value_changed", "Termination differs"]
  ] as const)("renders the neutral category for %s", (kind, title) => {
    const presentation = buildCaseDivergencePresentation(divergence(kind), 0, 2);
    expect(presentation?.title).toBe(title);

    const handle = createCaseBehavioralDiff({
      model: model({ presentation }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });
    expect(handle.element.textContent).toContain("First observed divergence");
    expect(handle.element.textContent).toContain(title);
    expect(handle.element.textContent).toContain("Case 1: left observed");
    expect(handle.element.textContent).toContain("Case 3: right observed");
    expect(handle.element.textContent?.toLowerCase()).not.toMatch(/\bwrong\b|\bbug\b|\bfix\b/);
    handle.dispose();
  });

  it("keeps no-divergence, coverage-ended, and alignment-stop states bounded", () => {
    const handle = createCaseBehavioralDiff({
      model: model({ presentation: undefined, stopReason: "coverage_ended" }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });
    expect(handle.element.textContent).toContain("No observed divergence before comparison coverage ended.");
    expect(handle.element.textContent).not.toContain("equivalent");

    handle.update(model({ presentation: undefined, stopReason: "ambiguous_alignment" }));
    expect(handle.element.textContent).toContain("could not be aligned safely");
    handle.dispose();
  });

  it("keeps incompatible pairs actionable without displaying testcase contents", () => {
    const handle = createCaseBehavioralDiff({
      model: model({ presentation: undefined, compatibility: { status: "different_source" } }),
      onInspectLeft: vi.fn(),
      onInspectRight: vi.fn()
    });
    const text = handle.element.textContent ?? "";
    expect(text).toContain("Run both Cases again with the same code.");
    expect(text).not.toMatch(/left observed|right observed/);
    expect(text).not.toMatch(/\[|\{|input/);
    handle.update(model({ presentation: undefined, compatibility: { status: "same_case" } }));
    expect(handle.element.textContent).toContain("Select a different Case");
    handle.dispose();
  });

  it("keeps Inspect side actions exact and exposes return-to-current while a side is active", () => {
    const onInspectLeft = vi.fn();
    const onInspectRight = vi.fn();
    const onReturnToCurrent = vi.fn();
    const handle = createCaseBehavioralDiff({
      model: model({ displayMode: "right" }),
      onInspectLeft,
      onInspectRight,
      onReturnToCurrent
    });

    handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-inspect-left")!.click();
    handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-inspect-right")!.click();
    handle.element.querySelector<HTMLButtonElement>("#case-behavioral-diff-return-current")!.click();

    expect(onInspectLeft).toHaveBeenCalledWith(8);
    expect(onInspectRight).toHaveBeenCalledWith(13);
    expect(onReturnToCurrent).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
});
