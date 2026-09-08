import { describe, expect, it, vi } from "vitest";

import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";
import { createBehavioralSignals } from "../../src/sidepanel/components/BehavioralSignals";

const analysis: BehavioralAnalysis = {
  patterns: [
    {
      kind: "repeated_state",
      patternId: "repeated_state:1:7:hash",
      startStep: 1,
      endStep: 7,
      repeatCount: 3,
      evidenceSteps: [1, 4, 7],
      location: { frameId: 1, functionName: "solve", line: 5 },
      stateFingerprintKey: "hash"
    },
    {
      kind: "no_progress",
      patternId: "no_progress:1:7:1:solve:5",
      startStep: 1,
      endStep: 7,
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [1, 4, 7],
      location: { frameId: 1, functionName: "solve", line: 5 }
    },
    {
      kind: "repeated_transition",
      patternId: "repeated_transition:2:10:3:A,B,C",
      startStep: 2,
      endStep: 10,
      repeatCount: 3,
      evidenceSteps: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      periodSteps: 3,
      motifKeys: ["A", "B", "C"]
    }
  ],
  stepAnnotations: []
};

describe("createBehavioralSignals", () => {
  function render(currentIndex: number, onNavigate = vi.fn()) {
    const traceIndex = buildTraceStepIndex([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const evidenceByPatternId = resolveBehavioralEvidenceMap(
      analysis.patterns,
      traceIndex
    );
    return {
      element: createBehavioralSignals({
        analysis,
        currentIndex,
        evidenceByPatternId,
        onNavigate
      }),
      onNavigate
    };
  }

  it("renders every factual pattern kind and marks exact current evidence", () => {
    const { element } = render(3); // raw index 3 = trace step 4
    const text = element.textContent ?? "";

    expect(text).toContain("Repeated state × 3");
    expect(text).toContain("solve · line 5");
    expect(text).toContain("No observable progress");
    expect(text).toContain("Repeated transition motif × 3");
    expect(text).toContain("3-step pattern");
    expect(element.querySelectorAll(".trace-viewer__behavioral-signal.is-active")).toHaveLength(3);
    expect(text).not.toMatch(/infinite loop|TLE|bug|fix/i);
  });

  it("navigates to the next exact evidence index rather than current plus one", () => {
    const { element, onNavigate } = render(0);
    const row = element.querySelector('[data-pattern-kind="repeated_state"]')!;

    row.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')!.click();

    expect(onNavigate).toHaveBeenCalledWith(3); // evidence steps [1,4,7]
  });

  it("disables first/previous at first evidence and next/last at last evidence", () => {
    const first = render(0).element.querySelector('[data-pattern-kind="repeated_state"]')!;
    expect(first.querySelector<HTMLButtonElement>('[data-behavior-action="first"]')?.disabled)
      .toBe(true);
    expect(first.querySelector<HTMLButtonElement>('[data-behavior-action="previous"]')?.disabled)
      .toBe(true);

    const last = render(6).element.querySelector('[data-pattern-kind="repeated_state"]')!;
    expect(last.querySelector<HTMLButtonElement>('[data-behavior-action="next"]')?.disabled)
      .toBe(true);
    expect(last.querySelector<HTMLButtonElement>('[data-behavior-action="last"]')?.disabled)
      .toBe(true);
  });

  it("keeps factual text but disables navigation when evidence cannot resolve", () => {
    const unresolved = {
      patterns: [{ ...analysis.patterns[0]!, patternId: "stale", evidenceSteps: [999] }],
      stepAnnotations: []
    } satisfies BehavioralAnalysis;
    const evidenceByPatternId = resolveBehavioralEvidenceMap(
      unresolved.patterns,
      buildTraceStepIndex([1, 2, 3])
    );
    const element = createBehavioralSignals({
      analysis: unresolved,
      currentIndex: 0,
      evidenceByPatternId,
      onNavigate: vi.fn()
    });

    expect(element.textContent).toContain("Repeated state × 3");
    expect([...element.querySelectorAll<HTMLButtonElement>("button")]
      .every((button) => button.disabled)).toBe(true);
  });

  it("renders a neutral empty state when no patterns are available", () => {
    expect(createBehavioralSignals({
      analysis: { patterns: [], stepAnnotations: [] },
      currentIndex: 0,
      evidenceByPatternId: new Map(),
      onNavigate: vi.fn()
    }).textContent)
      .toBe("No repeated behavioral signal in the captured trace.");
  });
});
