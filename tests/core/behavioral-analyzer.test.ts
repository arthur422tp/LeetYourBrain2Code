import { describe, expect, it } from "vitest";

import type { BehavioralObservation } from "../../src/core/behavioral-observation";
import {
  analyzeBehavioralPatterns,
  analyzeBehavioralPatternsSafely
} from "../../src/core/behavioral-analyzer";

function observation(
  step: number,
  exactState: string,
  overrides: Partial<BehavioralObservation> = {}
): BehavioralObservation {
  return {
    step,
    frameId: 1,
    functionName: "solve",
    currentLine: 5,
    location: { frameId: 1, functionName: "solve", line: 5 },
    locationKey: "1:solve:5",
    stateFingerprint: { key: `hash:${exactState}`, complete: true },
    normalizedStateKey: exactState,
    transitionFingerprint: { key: "1:solve:5|none", eligible: true },
    mutationCount: 0,
    ...overrides
  };
}

describe("analyzeBehavioralPatterns repeated state", () => {
  it("returns an empty analysis for an empty trace", () => {
    expect(analyzeBehavioralPatterns([])).toEqual({ patterns: [], stepAnnotations: [] });
  });

  it("emits repeated state after three exact complete matches", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same"),
      observation(4, "same"),
      observation(7, "same")
    ]);

    expect(analysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_state",
      startStep: 1,
      endStep: 7,
      repeatCount: 3,
      evidenceSteps: [1, 4, 7]
    }));
  });

  it("does not emit repeated state for only two matches", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same"),
      observation(4, "same")
    ]);

    expect(analysis.patterns.filter((pattern) => pattern.kind === "repeated_state")).toEqual([]);
  });

  it("does not merge equal states from different frames", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same"),
      observation(4, "same", {
        frameId: 2,
        location: { frameId: 2, functionName: "solve", line: 5 },
        locationKey: "2:solve:5"
      }),
      observation(7, "same")
    ]);

    expect(analysis.patterns.filter((pattern) => pattern.kind === "repeated_state")).toEqual([]);
  });

  it("requires exact normalized equality after candidate fingerprint matching", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "left:1", { stateFingerprint: { key: "same-hash", complete: true } }),
      observation(4, "left:2", { stateFingerprint: { key: "same-hash", complete: true } }),
      observation(7, "left:3", { stateFingerprint: { key: "same-hash", complete: true } })
    ]);

    expect(analysis.patterns.filter((pattern) => pattern.kind === "repeated_state")).toEqual([]);
  });

  it("does not emit exact-state patterns for incomplete observations", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same", { stateFingerprint: { key: "hash:same", complete: false } }),
      observation(4, "same", { stateFingerprint: { key: "hash:same", complete: false } }),
      observation(7, "same", { stateFingerprint: { key: "hash:same", complete: false } })
    ]);

    expect(analysis.patterns.filter((pattern) =>
      pattern.kind === "repeated_state" || pattern.kind === "no_progress"
    )).toEqual([]);
  });
});

describe("analyzeBehavioralPatterns no progress", () => {
  it("emits no progress for consecutive exact-equal anchor visits", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same"),
      observation(3, "same"),
      observation(5, "same")
    ]);

    expect(analysis.patterns).toContainEqual(expect.objectContaining({
      kind: "no_progress",
      repeatCount: 3,
      revisitCount: 2,
      evidenceSteps: [1, 3, 5]
    }));
  });

  it("resets no-progress runs when the anchor state changes", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "same"),
      observation(3, "different"),
      observation(5, "same"),
      observation(7, "same"),
      observation(9, "same")
    ]);
    const noProgress = analysis.patterns.filter((pattern) => pattern.kind === "no_progress");

    expect(noProgress).toContainEqual(expect.objectContaining({
      evidenceSteps: [5, 7, 9],
      startStep: 5,
      endStep: 9
    }));
    expect(noProgress).not.toContainEqual(expect.objectContaining({
      evidenceSteps: [1, 5, 7]
    }));
  });

  it("does not infer no progress from empty mutations when exact state changes", () => {
    const analysis = analyzeBehavioralPatterns([
      observation(1, "left:0"),
      observation(3, "left:1"),
      observation(5, "left:2")
    ]);

    expect(analysis.patterns.filter((pattern) => pattern.kind === "no_progress")).toEqual([]);
  });
});

describe("analyzeBehavioralPatterns safety", () => {
  it("returns the empty analysis when the safe wrapper receives malformed input", () => {
    const malformed = [1, 2, 3].map((step) =>
      ({ step } as unknown as BehavioralObservation)
    );

    expect(analyzeBehavioralPatternsSafely(malformed)).toEqual({
      patterns: [],
      stepAnnotations: []
    });
  });
});

describe("analyzeBehavioralPatterns bounds", () => {
  it("caps patterns deterministically and annotates only retained patterns", () => {
    const observations = Array.from({ length: 65 }, (_, group) =>
      [0, 1, 2].map((offset) => {
        const step = group * 3 + offset + 1;
        return observation(step, `state-${group}`, {
          location: { frameId: group + 1, functionName: "solve", line: 5 },
          locationKey: `${group + 1}:solve:5`,
          transitionFingerprint: {
            key: `${group + 1}:solve:5|none`,
            eligible: true
          }
        });
      })
    ).flat();
    const analysis = analyzeBehavioralPatterns(observations);
    const retainedIds = new Set(analysis.patterns.map((pattern) => pattern.patternId));

    expect(analysis.patterns).toHaveLength(64);
    expect(analysis.stepAnnotations.every((annotation) =>
      annotation.patternIds.every((patternId) => retainedIds.has(patternId))
    )).toBe(true);
  });
});

describe("analyzeBehavioralPatterns repeated transitions", () => {
  function transition(
    step: number,
    key: string,
    eligible = true
  ): BehavioralObservation {
    return observation(step, `state-${step}`, {
      transitionFingerprint: { key, eligible },
      mutationCount: key.endsWith("|none") ? 0 : 1
    });
  }

  it("detects one-step transition repetition", () => {
    const analysis = analyzeBehavioralPatterns(
      [1, 2, 3].map((step) => transition(step, "1:solve:5|variable:i:changed:int->int"))
    );

    expect(analysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 1,
      repeatCount: 3
    }));
  });

  it("detects a three-step transition motif", () => {
    const keys = ["A", "B", "C", "A", "B", "C", "A", "B", "C"];
    const analysis = analyzeBehavioralPatterns(keys.map((key, index) =>
      transition(index + 1, `1:solve:5|${key}`)
    ));

    expect(analysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 3,
      repeatCount: 3,
      startStep: 1,
      endStep: 9,
      motifKeys: ["1:solve:5|A", "1:solve:5|B", "1:solve:5|C"]
    }));
  });

  it("keeps none transitions inside a repeated motif", () => {
    const keys = ["none", "variable", "none", "variable", "none", "variable"];
    const analysis = analyzeBehavioralPatterns(keys.map((key, index) =>
      transition(index + 1, `1:solve:5|${key}`)
    ));

    expect(analysis.patterns).toContainEqual(expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 2,
      repeatCount: 3,
      motifKeys: ["1:solve:5|none", "1:solve:5|variable"]
    }));
  });

  it("does not let initialization observations join a motif", () => {
    const analysis = analyzeBehavioralPatterns([
      transition(1, "1:solve:5|initialization", false),
      transition(2, "1:solve:5|A"),
      transition(3, "1:solve:5|B"),
      transition(4, "1:solve:5|A"),
      transition(5, "1:solve:5|B"),
      transition(6, "1:solve:5|A"),
      transition(7, "1:solve:5|B")
    ]);
    const transitions = analysis.patterns.filter((pattern) => pattern.kind === "repeated_transition");

    expect(transitions.length).toBeGreaterThan(0);
    expect(transitions.every((pattern) => pattern.startStep >= 2)).toBe(true);
  });

  it("requires at least three motif repetitions", () => {
    const analysis = analyzeBehavioralPatterns([
      transition(1, "A"),
      transition(2, "B"),
      transition(3, "A"),
      transition(4, "B")
    ]);

    expect(analysis.patterns.filter((pattern) => pattern.kind === "repeated_transition")).toEqual([]);
  });

  it("merges extensions into one minimal-period pattern", () => {
    const analysis = analyzeBehavioralPatterns(
      [1, 2, 3, 4, 5, 6].map((step) => transition(step, "A"))
    );
    const transitions = analysis.patterns.filter((pattern) => pattern.kind === "repeated_transition");

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      periodSteps: 1,
      repeatCount: 6,
      startStep: 1,
      endStep: 6,
      motifKeys: ["A"]
    });
  });
});
