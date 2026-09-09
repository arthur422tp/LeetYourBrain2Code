import { describe, expect, it } from "vitest";
import type { BehavioralPattern } from "../../src/core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "../../src/sidepanel/behavioral-navigation";
import { buildTraceFoldModel } from "../../src/sidepanel/trace-folding";

function transition(id: string, evidenceSteps: number[], periodSteps: number, repeatCount: number): BehavioralPattern {
  return { kind: "repeated_transition", patternId: id, startStep: evidenceSteps[0] ?? 0, endStep: evidenceSteps.at(-1) ?? 0, repeatCount, evidenceSteps, periodSteps, motifKeys: Array.from({ length: periodSteps }, (_, i) => `m${i}`) };
}

function resolved(id: string, evidenceSteps: number[], evidenceIndexes: number[]): ResolvedBehavioralEvidence {
  return { patternId: id, evidenceSteps, evidenceIndexes, firstIndex: evidenceIndexes[0] ?? null, lastIndex: evidenceIndexes.at(-1) ?? null };
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

  it("returns one raw range when no fold is eligible", () => {
    expect(buildTraceFoldModel(4, [], new Map()).segments).toEqual([{ kind: "raw_range", segmentId: "raw:0:3", startIndex: 0, endIndex: 3 }]);
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

  it("partitions every raw index exactly once", () => {
    const pattern = transition("p", [1,2,3,4,5,6], 2, 3);
    const model = buildTraceFoldModel(10, [pattern], new Map([["p", resolved("p", pattern.evidenceSteps, [2,3,4,5,6,7])]]));
    const owned = model.segments.flatMap((segment) => Array.from({ length: segment.endIndex - segment.startIndex + 1 }, (_, offset) => segment.startIndex + offset));
    expect(owned).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(new Set(owned).size).toBe(10);
  });
});
