import { describe, expect, it } from "vitest";

import type { BehavioralPattern } from "../../src/core/behavioral-pattern";
import {
  buildTraceStepIndex,
  nextEvidenceIndex,
  previousEvidenceIndex,
  resolveBehavioralEvidence,
  resolveBehavioralEvidenceMap
} from "../../src/sidepanel/behavioral-navigation";

const pattern: BehavioralPattern = {
  kind: "repeated_state",
  patternId: "repeated_state:10:70:hash",
  startStep: 10,
  endStep: 70,
  repeatCount: 4,
  evidenceSteps: [70, 10, 30, 30, 999],
  location: { frameId: 1, functionName: "solve", line: 8 },
  stateFingerprintKey: "hash"
};

describe("behavioral navigation", () => {
  it("maps non-contiguous trace step ids to display indexes without step-minus-one assumptions", () => {
    const index = buildTraceStepIndex([10, 30, 50, 70]);

    expect(index.stepToIndex.get(10)).toBe(0);
    expect(index.stepToIndex.get(30)).toBe(1);
    expect(index.stepToIndex.get(70)).toBe(3);
    expect(index.indexToStep).toEqual([10, 30, 50, 70]);
  });

  it("keeps the first index for duplicate trace step ids", () => {
    const index = buildTraceStepIndex([10, 30, 30, 70]);

    expect(index.stepToIndex.get(30)).toBe(1);
    expect(index.indexToStep).toEqual([10, 30, 30, 70]);
  });

  it("drops missing evidence, deduplicates resolved indexes, and sorts in trace order", () => {
    const resolved = resolveBehavioralEvidence(
      pattern,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(resolved).toEqual({
      patternId: pattern.patternId,
      evidenceSteps: [10, 30, 70],
      evidenceIndexes: [0, 1, 3],
      firstIndex: 0,
      lastIndex: 3
    });
  });

  it("returns nearest strict previous and next evidence without wrapping", () => {
    const evidence = resolveBehavioralEvidence(
      pattern,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(previousEvidenceIndex(evidence, 0)).toBeNull();
    expect(previousEvidenceIndex(evidence, 2)).toBe(1);
    expect(previousEvidenceIndex(evidence, 3)).toBe(1);
    expect(nextEvidenceIndex(evidence, 0)).toBe(1);
    expect(nextEvidenceIndex(evidence, 2)).toBe(3);
    expect(nextEvidenceIndex(evidence, 3)).toBeNull();
  });

  it("returns a disabled shape when every evidence step is unresolved", () => {
    const unresolved: BehavioralPattern = {
      ...pattern,
      patternId: "unresolved",
      evidenceSteps: [901, 902]
    };
    const resolved = resolveBehavioralEvidence(
      unresolved,
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(resolved.evidenceSteps).toEqual([]);
    expect(resolved.evidenceIndexes).toEqual([]);
    expect(resolved.firstIndex).toBeNull();
    expect(resolved.lastIndex).toBeNull();
  });

  it("resolves all patterns once into a pattern-id map", () => {
    const map = resolveBehavioralEvidenceMap(
      [pattern],
      buildTraceStepIndex([10, 30, 50, 70])
    );

    expect(map.get(pattern.patternId)?.evidenceIndexes).toEqual([0, 1, 3]);
  });
});
