import { describe, expect, it } from "vitest";
import type { BehavioralPattern, RepeatedTransitionPattern } from "../../src/core/behavioral-pattern";
import { buildTraceStepIndex, resolveBehavioralEvidenceMap, type ResolvedBehavioralEvidence } from "../../src/sidepanel/behavioral-navigation";
import { buildTraceFoldModel } from "../../src/sidepanel/trace-folding";

function transition(id: string, evidenceSteps: number[], periodSteps: number, repeatCount: number): RepeatedTransitionPattern {
  return { kind: "repeated_transition", patternId: id, startStep: evidenceSteps[0] ?? 0, endStep: evidenceSteps.at(-1) ?? 0, repeatCount, evidenceSteps, periodSteps, motifKeys: Array.from({ length: periodSteps }, (_, i) => `m${i}`) };
}

function resolved(id: string, evidenceSteps: number[], evidenceIndexes: number[]): ResolvedBehavioralEvidence {
  return { patternId: id, evidenceSteps, evidenceIndexes, firstIndex: evidenceIndexes[0] ?? null, lastIndex: evidenceIndexes.at(-1) ?? null };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest])
  );
}

describe("buildTraceFoldModel", () => {
  it("folds one complete contiguous repeated-transition interval", () => {
    const pattern = transition("p", [10, 11, 12, 13, 14, 15], 2, 3);
    const model = buildTraceFoldModel(10, [pattern], new Map([["p", resolved("p", pattern.evidenceSteps, [2, 3, 4, 5, 6, 7])]]));
    expect(model.segments).toEqual([
      { kind: "raw_range", segmentId: "raw:0:1", startIndex: 0, endIndex: 1 },
      { kind: "repeated_transition_fold", segmentId: "fold:p", patternId: "p", startIndex: 2, endIndex: 7, periodSteps: 2, repeatCount: 3, iterations: [{ iteration: 1, startIndex: 2, endIndex: 3 }, { iteration: 2, startIndex: 4, endIndex: 5 }, { iteration: 3, startIndex: 6, endIndex: 7 }] },
      { kind: "raw_range", segmentId: "raw:8:9", startIndex: 8, endIndex: 9 }
    ]);
  });

  it("rejects gapped or partially resolved evidence", () => {
    const pattern = transition("p", [1, 2, 3, 4, 5, 6], 2, 3);
    expect(buildTraceFoldModel(8, [pattern], new Map([["p", resolved("p", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])]])).foldedPatternIds).toEqual([]);
    expect(buildTraceFoldModel(8, [pattern], new Map([["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 5, 6, 7])]])).foldedPatternIds).toEqual([]);
  });

  it("rejects evidence whose length differs from periodSteps times repeatCount", () => {
    const pattern = transition("p", [1, 2, 3, 4, 5], 2, 3);
    expect(buildTraceFoldModel(6, [pattern], new Map([["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 4, 5])]])).foldedPatternIds).toEqual([]);
  });

  it.each([
    ["fewer step identities than indexes", [10, 11, 12]],
    ["more step identities than indexes", [10, 11, 12, 13, 14, 15, 16]],
    ["duplicate step identities", [10, 11, 12, 10, 11, 12]]
  ])("keeps a raw-only partition for %s", (_name, steps) => {
    const pattern = transition("p", steps, 2, 3);
    const model = buildTraceFoldModel(8, [pattern], new Map([
      ["p", resolved("p", steps, [0, 1, 2, 3, 4, 5])]
    ]));

    expect(model).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:7", startIndex: 0, endIndex: 7 }]
    });
  });

  it("rejects evidence whose endpoints do not bind the contiguous indexes", () => {
    const pattern = transition("p", [1, 2, 3, 4, 5, 6], 2, 3);
    const evidence = resolved("p", pattern.evidenceSteps, [0, 1, 2, 3, 4, 5]);
    expect(buildTraceFoldModel(8, [pattern], new Map([["p", { ...evidence, firstIndex: 1, lastIndex: 6 }]])).foldedPatternIds).toEqual([]);
    expect(buildTraceFoldModel(8, [pattern], new Map([["p", { ...evidence, evidenceIndexes: [0, 1, 2, 3, 4.5, 5] }]])).foldedPatternIds).toEqual([]);
  });

  it("returns one raw range when no fold is eligible", () => {
    expect(buildTraceFoldModel(4, [], new Map()).segments).toEqual([{ kind: "raw_range", segmentId: "raw:0:3", startIndex: 0, endIndex: 3 }]);
  });

  it.each(["repeated_state", "no_progress"] as const)("keeps %s evidence raw", (kind) => {
    const base = transition("p", [10, 11, 12, 13, 14, 15], 2, 3);
    const location = { frameId: 1, functionName: "solve", line: 5 };
    const pattern: BehavioralPattern = kind === "repeated_state"
      ? { ...base, kind, location, stateFingerprintKey: "state" }
      : { ...base, kind, location, revisitCount: 3 };
    const model = buildTraceFoldModel(8, [pattern], new Map([
      ["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 4, 5, 6])]
    ]));
    expect(model).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:7", startIndex: 0, endIndex: 7 }]
    });
  });

  it("keeps a pattern with no map entry raw", () => {
    const pattern = transition("p", [10, 11, 12, 13, 14, 15], 2, 3);
    expect(buildTraceFoldModel(8, [pattern], new Map())).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:7", startIndex: 0, endIndex: 7 }]
    });
  });

  it.each<[string, Partial<ResolvedBehavioralEvidence>]>([
    ["pattern identity mismatch", { patternId: "other" }],
    ["step identity mismatch", { evidenceSteps: [10, 11, 12, 13, 14, 99] }],
    ["duplicate resolved identity", { evidenceSteps: [10, 11, 12, 13, 14, 14] }],
    ["reordered identities", { evidenceSteps: [11, 10, 12, 13, 14, 15] }],
    ["missing resolved identity", { evidenceSteps: [10, 11, 12, 13, 14] }],
    ["unresolved first endpoint", { firstIndex: null }],
    ["unresolved last endpoint", { lastIndex: null }],
    ["negative raw index", { evidenceIndexes: [-1, 0, 1, 2, 3, 4], firstIndex: -1, lastIndex: 4 }],
    ["raw index at trace length", { evidenceIndexes: [3, 4, 5, 6, 7, 8], firstIndex: 3, lastIndex: 8 }]
  ])("falls back to raw for %s", (_name, overrides) => {
    const pattern = transition("p", [10, 11, 12, 13, 14, 15], 2, 3);
    const evidence = { ...resolved("p", pattern.evidenceSteps, [1, 2, 3, 4, 5, 6]), ...overrides };
    expect(buildTraceFoldModel(8, [pattern], new Map([["p", evidence]]))).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:7", startIndex: 0, endIndex: 7 }]
    });
  });

  it.each([
    [0, 3], [-2, 3], [1.5, 4], [NaN, 3], [Infinity, 3],
    [2, 0], [2, -3], [3, 2], [4, 1.5], [2, NaN], [2, Infinity]
  ])("rejects invalid period %s / repeat count %s", (periodSteps, repeatCount) => {
    const pattern = { ...transition("p", [10, 11, 12, 13, 14, 15], 2, 3), periodSteps, repeatCount };
    expect(buildTraceFoldModel(8, [pattern], new Map([
      ["p", resolved("p", pattern.evidenceSteps, [1, 2, 3, 4, 5, 6])]
    ]))).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:7", startIndex: 0, endIndex: 7 }]
    });
  });

  it("folds normally resolved nonconsecutive step IDs without changing raw ownership", () => {
    const steps = [10, 20, 40, 80, 160, 320];
    const pattern = transition("p", steps, 2, 3);
    const map = resolveBehavioralEvidenceMap([pattern], buildTraceStepIndex([5, ...steps, 640]));
    expect(buildTraceFoldModel(8, [pattern], map)).toEqual({
      foldedPatternIds: ["p"],
      segments: [
        { kind: "raw_range", segmentId: "raw:0:0", startIndex: 0, endIndex: 0 },
        {
          kind: "repeated_transition_fold", segmentId: "fold:p", patternId: "p",
          startIndex: 1, endIndex: 6, periodSteps: 2, repeatCount: 3,
          iterations: [
            { iteration: 1, startIndex: 1, endIndex: 2 },
            { iteration: 2, startIndex: 3, endIndex: 4 },
            { iteration: 3, startIndex: 5, endIndex: 6 }
          ]
        },
        { kind: "raw_range", segmentId: "raw:7:7", startIndex: 7, endIndex: 7 }
      ]
    });
  });

  it.each([
    ["missing", [10, 11, 12, 13, 14, 99]],
    ["duplicate", [10, 11, 12, 10, 11, 12]]
  ])("keeps %s identities raw after normal evidence resolution", (_name, steps) => {
    const pattern = transition("p", steps, 2, 3);
    const map = resolveBehavioralEvidenceMap([pattern], buildTraceStepIndex([10, 11, 12, 13, 14, 15]));
    expect(buildTraceFoldModel(6, [pattern], map)).toEqual({
      foldedPatternIds: [],
      segments: [{ kind: "raw_range", segmentId: "raw:0:5", startIndex: 0, endIndex: 5 }]
    });
  });

  it("returns an empty model for an empty trace", () => {
    expect(buildTraceFoldModel(0, [], new Map())).toEqual({ segments: [], foldedPatternIds: [] });
  });

  it("maximizes total folded raw coverage for overlapping candidates", () => {
    const left = transition("left", [1,2,3,4,5,6], 2, 3), middle = transition("middle", [3,4,5,6,7,8], 2, 3), right = transition("right", [7,8,9,10,11,12], 2, 3);
    const map = new Map<string, ResolvedBehavioralEvidence>([["left", resolved("left", left.evidenceSteps, [0,1,2,3,4,5])], ["middle", resolved("middle", middle.evidenceSteps, [2,3,4,5,6,7])], ["right", resolved("right", right.evidenceSteps, [6,7,8,9,10,11])]]);
    expect(buildTraceFoldModel(12, [left, middle, right], map).foldedPatternIds).toEqual(["left", "right"]);
  });

  it("uses the earlier-starting candidate for equal-coverage ties", () => {
    const earlier = transition("earlier", [1,2,3,4,5,6], 2, 3), later = transition("later", [2,3,4,5,6,7], 2, 3);
    const map = new Map<string, ResolvedBehavioralEvidence>([["earlier", resolved("earlier", earlier.evidenceSteps, [0,1,2,3,4,5])], ["later", resolved("later", later.evidenceSteps, [1,2,3,4,5,6])]]);
    expect(buildTraceFoldModel(7, [later, earlier], map).foldedPatternIds).toEqual(["earlier"]);
  });

  it.each<{
    preference: string;
    candidates: Array<[id: string, start: number, period: number, repeats: number]>;
    expected: string[];
  }>([
    {
      preference: "fewer folds before earlier start",
      candidates: [["whole", 1, 4, 3], ["left", 0, 2, 3], ["right", 6, 2, 3]],
      expected: ["whole"]
    },
    {
      preference: "earlier start",
      candidates: [["earlier", 0, 2, 3], ["later", 1, 2, 3]],
      expected: ["earlier"]
    },
    {
      preference: "larger first span before smaller period",
      candidates: [["short-left", 0, 2, 3], ["long-left", 0, 3, 3], ["long-right", 6, 3, 3], ["short-right", 9, 2, 3]],
      expected: ["long-left", "short-right"]
    },
    {
      preference: "smaller period before pattern ID",
      candidates: [["a-wide", 0, 2, 3], ["z-narrow", 0, 1, 6]],
      expected: ["z-narrow"]
    },
    {
      preference: "lexicographically smaller pattern ID",
      candidates: [["z", 0, 2, 3], ["a", 0, 2, 3]],
      expected: ["a"]
    }
  ])("prefers $preference under every input ordering", ({ candidates, expected }) => {
    const entries = candidates.map(([id, start, period, repeats]) => {
      const indexes = Array.from({ length: period * repeats }, (_, offset) => start + offset);
      const pattern = transition(id, indexes.map((index) => index + 100), period, repeats);
      return { pattern, evidence: resolved(id, pattern.evidenceSteps, indexes) };
    });
    for (const order of permutations(entries)) {
      for (const mapOrder of [order, [...order].reverse()]) {
        const model = buildTraceFoldModel(16, order.map(({ pattern }) => pattern),
          new Map(mapOrder.map(({ pattern, evidence }) => [pattern.patternId, evidence])));
        expect(model.foldedPatternIds).toEqual(expected);
        expect(model.segments.flatMap((segment) =>
          Array.from({ length: segment.endIndex - segment.startIndex + 1 }, (_, offset) => segment.startIndex + offset)
        )).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      }
    }
  });

  it("partitions every raw index exactly once", () => {
    const pattern = transition("p", [1,2,3,4,5,6], 2, 3);
    const model = buildTraceFoldModel(10, [pattern], new Map([["p", resolved("p", pattern.evidenceSteps, [2,3,4,5,6,7])]]));
    const owned = model.segments.flatMap((segment) => Array.from({ length: segment.endIndex - segment.startIndex + 1 }, (_, offset) => segment.startIndex + offset));
    expect(owned).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(new Set(owned).size).toBe(10);
  });
});
