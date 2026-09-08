import { describe, expect, it } from "vitest";

import type { BehavioralAnalysis } from "../../src/core/behavioral-pattern";
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
  it("renders every factual pattern kind and marks the active evidence row", () => {
    const element = createBehavioralSignals(analysis, 4);
    const text = element.textContent ?? "";

    expect(text).toContain("Repeated state × 3");
    expect(text).toContain("solve · line 5");
    expect(text).toContain("No observable progress");
    expect(text).toContain("Repeated transition motif × 3");
    expect(text).toContain("3-step pattern");
    expect(element.querySelectorAll(".trace-viewer__behavioral-signal.is-active")).toHaveLength(3);
    expect(text).not.toMatch(/infinite loop|TLE|bug|fix/i);
  });

  it("renders a neutral empty state when no patterns are available", () => {
    expect(createBehavioralSignals({ patterns: [], stepAnnotations: [] }, 1).textContent)
      .toBe("No repeated behavioral signal in the captured trace.");
  });
});
