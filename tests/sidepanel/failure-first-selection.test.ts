import { describe, expect, it } from "vitest";

import type {
  NoProgressPattern,
  RepeatedStatePattern,
  RepeatedTransitionPattern
} from "../../src/core/behavioral-pattern";
import type { TraceSessionStatus } from "../../src/shared/execution-types";
import type { ResolvedBehavioralEvidence } from "../../src/sidepanel/behavioral-navigation";
import { selectFailureFirstEvidence } from "../../src/sidepanel/failure-first-selection";

function repeatedStatePattern(
  patternId: string,
  repeatCount: number,
  evidenceSteps: number[]
): RepeatedStatePattern {
  return {
    kind: "repeated_state",
    patternId,
    startStep: evidenceSteps[0]!,
    endStep: evidenceSteps.at(-1)!,
    repeatCount,
    evidenceSteps,
    location: { frameId: 1, functionName: "solve", line: 3 },
    stateFingerprintKey: patternId
  };
}

function noProgressPattern(
  patternId: string,
  repeatCount: number,
  revisitCount: number,
  evidenceSteps: number[]
): NoProgressPattern {
  return {
    kind: "no_progress",
    patternId,
    startStep: evidenceSteps[0]!,
    endStep: evidenceSteps.at(-1)!,
    repeatCount,
    revisitCount,
    evidenceSteps,
    location: { frameId: 1, functionName: "solve", line: 3 }
  };
}

function repeatedTransitionPattern(
  patternId: string,
  repeatCount: number,
  periodSteps: number,
  evidenceSteps: number[]
): RepeatedTransitionPattern {
  return {
    kind: "repeated_transition",
    patternId,
    startStep: evidenceSteps[0]!,
    endStep: evidenceSteps.at(-1)!,
    repeatCount,
    periodSteps,
    evidenceSteps,
    motifKeys: Array.from({ length: periodSteps }, (_, index) => `motif-${index}`)
  };
}

function resolvedEvidence(
  patternId: string,
  evidenceSteps: number[],
  evidenceIndexes: number[]
): ResolvedBehavioralEvidence {
  return {
    patternId,
    evidenceSteps,
    evidenceIndexes,
    firstIndex: evidenceIndexes[0] ?? null,
    lastIndex: evidenceIndexes.at(-1) ?? null
  };
}

interface CandidateFixture {
  pattern: RepeatedStatePattern;
  evidence: ResolvedBehavioralEvidence;
}

function candidateFixture(
  patternId: string,
  repeatCount: number,
  evidenceIndexes: number[]
): CandidateFixture {
  const evidenceSteps = evidenceIndexes.map((_, index) => index + 1);
  const pattern = repeatedStatePattern(patternId, repeatCount, evidenceSteps);
  return {
    pattern,
    evidence: resolvedEvidence(patternId, evidenceSteps, evidenceIndexes)
  };
}

function selectFixtures(fixtures: CandidateFixture[]) {
  return selectFailureFirstEvidence(
    "timeout",
    100,
    fixtures.map(({ pattern }) => pattern),
    new Map(fixtures.map(({ pattern, evidence }) => [pattern.patternId, evidence]))
  );
}

function selectSingle(
  status: TraceSessionStatus,
  rawTraceLength: number,
  pattern: RepeatedStatePattern | NoProgressPattern | RepeatedTransitionPattern,
  evidence: ResolvedBehavioralEvidence
) {
  return selectFailureFirstEvidence(
    status,
    rawTraceLength,
    [pattern],
    new Map([[pattern.patternId, evidence]])
  );
}

describe("selectFailureFirstEvidence", () => {
  it.each(["running", "completed", "parse_error", "input_error", "internal_error"] as const)(
    "%s returns null",
    (status: TraceSessionStatus) => {
      const pattern = repeatedStatePattern("state-a", 3, [7, 8, 9]);
      const evidence = resolvedEvidence("state-a", [7, 8, 9], [6, 7, 8]);

      expect(selectFailureFirstEvidence(
        status,
        10,
        [pattern],
        new Map([["state-a", evidence]])
      )).toBeNull();
    }
  );

  it.each(["exception", "trace_limit", "timeout"] as const)(
    "%s evaluates eligible candidates",
    (status: TraceSessionStatus) => {
      const pattern = repeatedStatePattern("state-a", 3, [7, 8, 9]);
      const evidence = resolvedEvidence("state-a", [7, 8, 9], [6, 7, 8]);

      expect(selectFailureFirstEvidence(
        status,
        10,
        [pattern],
        new Map([["state-a", evidence]])
      )).toMatchObject({
        patternId: "state-a",
        inspectIndex: 8,
        distanceFromTermination: 1
      });
    }
  );

  it("accepts distance 32", () => {
    const pattern = repeatedStatePattern("near", 3, [68]);
    const evidence = resolvedEvidence("near", [68], [67]);

    expect(selectFailureFirstEvidence(
      "timeout",
      100,
      [pattern],
      new Map([["near", evidence]])
    )).toMatchObject({ distanceFromTermination: 32 });
  });

  it("rejects distance 33", () => {
    const pattern = repeatedStatePattern("far", 3, [67]);
    const evidence = resolvedEvidence("far", [67], [66]);

    expect(selectFailureFirstEvidence(
      "timeout",
      100,
      [pattern],
      new Map([["far", evidence]])
    )).toBeNull();
  });

  it("prefers smaller terminal distance before every other ranking field", () => {
    const farButLongerCandidate = candidateFixture("far", 3, [80, 81, 95]);
    const nearCandidate = candidateFixture("near", 3, [96, 97, 98]);

    expect(selectFixtures([farButLongerCandidate, nearCandidate])?.patternId).toBe("near");
  });

  it("prefers larger evidence span when terminal distance ties", () => {
    const shortSpanCandidate = candidateFixture("short-span", 3, [96, 97, 98]);
    const longSpanCandidate = candidateFixture("long-span", 3, [70, 85, 98]);

    expect(selectFixtures([shortSpanCandidate, longSpanCandidate])?.patternId).toBe("long-span");
  });

  it("prefers larger repeatCount when distance and span tie", () => {
    const lowRepeatCandidate = candidateFixture("low-repeat", 3, [96, 97, 98]);
    const highRepeatCandidate = candidateFixture("high-repeat", 5, [96, 97, 98]);

    expect(selectFixtures([lowRepeatCandidate, highRepeatCandidate])?.patternId).toBe("high-repeat");
  });

  it("prefers lexicographically smaller patternId on a complete tie", () => {
    const candidateB = candidateFixture("b-pattern", 3, [96, 97, 98]);
    const candidateA = candidateFixture("a-pattern", 3, [96, 97, 98]);

    expect(selectFixtures([candidateB, candidateA])?.patternId).toBe("a-pattern");
  });

  it("returns the same selection regardless of candidate permutation", () => {
    const a = candidateFixture("a-pattern", 3, [96, 97, 98]);
    const b = candidateFixture("b-pattern", 3, [80, 81, 95]);
    const c = candidateFixture("c-pattern", 5, [70, 85, 98]);

    expect(selectFixtures([a, b, c])).toEqual(selectFixtures([c, b, a]));
  });

  it("rejects partial resolution", () => {
    const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
    const evidence = resolvedEvidence("p", [7, 8], [6, 7]);

    expect(selectSingle("timeout", 10, pattern, evidence)).toBeNull();
  });

  it("rejects duplicate pattern evidence step identities", () => {
    const pattern = repeatedStatePattern("p", 3, [7, 7, 8]);
    const evidence = resolvedEvidence("p", [7, 8], [6, 7]);

    expect(selectSingle("timeout", 10, pattern, evidence)).toBeNull();
  });

  it("rejects reordered resolved identities", () => {
    const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
    const evidence = resolvedEvidence("p", [7, 9, 8], [6, 7, 8]);

    expect(selectSingle("timeout", 10, pattern, evidence)).toBeNull();
  });

  it("rejects malformed endpoints", () => {
    const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
    const evidence = {
      ...resolvedEvidence("p", [7, 8, 9], [6, 7, 8]),
      firstIndex: 5
    };

    expect(selectSingle("timeout", 10, pattern, evidence)).toBeNull();
  });

  it.each([[[6.5, 7, 8]], [[-1, 7, 8]], [[6, 7, 10]]] as const)(
    "rejects malformed raw indexes %j",
    (indexes: readonly number[]) => {
      const pattern = repeatedStatePattern("p", 3, [7, 8, 9]);
      const evidence = resolvedEvidence("p", [7, 8, 9], [...indexes]);

      expect(selectSingle("timeout", 10, pattern, evidence)).toBeNull();
    }
  );

  it("returns null for an empty trace or no patterns", () => {
    expect(selectFailureFirstEvidence("timeout", 0, [], new Map())).toBeNull();
    expect(selectFailureFirstEvidence("timeout", 10, [], new Map())).toBeNull();
  });

  it("lands on the first raw index of the final complete repeated transition motif", () => {
    const pattern = repeatedTransitionPattern("transition", 3, 2, [10, 11, 12, 13, 14, 15]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [0, 1, 2, 3, 4, 5]);

    expect(selectSingle("timeout", 6, pattern, evidence)).toEqual(expect.objectContaining({
      kind: "repeated_transition",
      periodSteps: 2,
      repeatCount: 3,
      inspectIndex: 4
    }));
  });

  it("lands repeated state recommendations on the final evidence index", () => {
    const pattern = repeatedStatePattern("state", 3, [10, 30, 50]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [1, 3, 5]);

    expect(selectSingle("timeout", 6, pattern, evidence)).toEqual(expect.objectContaining({
      kind: "repeated_state",
      inspectIndex: evidence.lastIndex
    }));
  });

  it("lands no-progress recommendations on the final evidence index and copies revisitCount", () => {
    const pattern = noProgressPattern("stalled", 5, 4, [10, 20, 30, 40, 50]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [0, 1, 2, 3, 4]);

    expect(selectSingle("timeout", 5, pattern, evidence)).toEqual(expect.objectContaining({
      kind: "no_progress",
      revisitCount: 4,
      inspectIndex: evidence.lastIndex
    }));
  });

  it("rejects a repeated transition with a non-positive period", () => {
    const pattern = repeatedTransitionPattern("transition", 3, 0, [10, 11, 12]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [0, 1, 2]);

    expect(selectSingle("timeout", 3, pattern, evidence)).toBeNull();
  });

  it("rejects a repeated transition with evidence length that does not match its period", () => {
    const pattern = repeatedTransitionPattern("transition", 3, 2, [10, 11, 12, 13, 14]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [0, 1, 2, 3, 4]);

    expect(selectSingle("timeout", 5, pattern, evidence)).toBeNull();
  });

  it("rejects a repeated transition with gapped resolved indexes", () => {
    const pattern = repeatedTransitionPattern("transition", 3, 2, [10, 11, 12, 13, 14, 15]);
    const evidence = resolvedEvidence(pattern.patternId, pattern.evidenceSteps, [0, 1, 3, 4, 5, 6]);

    expect(selectSingle("timeout", 7, pattern, evidence)).toBeNull();
  });
});
