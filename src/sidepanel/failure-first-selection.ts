import {
  MIN_PATTERN_REPEATS,
  type BehavioralPattern
} from "../core/behavioral-pattern";
import type { TraceSessionStatus } from "../shared/execution-types";
import type { ResolvedBehavioralEvidence } from "./behavioral-navigation";

export const FAILURE_FIRST_TERMINAL_WINDOW_STEPS = 32;

interface FailureFirstSelectionBase {
  patternId: string;
  inspectIndex: number;
  evidenceStartIndex: number;
  evidenceEndIndex: number;
  distanceFromTermination: number;
  repeatCount: number;
  reason: "nearest_terminal_evidence";
}

export interface RepeatedTransitionFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "repeated_transition";
  periodSteps: number;
}

export interface RepeatedStateFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "repeated_state";
}

export interface NoProgressFailureFirstSelection
  extends FailureFirstSelectionBase {
  kind: "no_progress";
  revisitCount: number;
}

export type FailureFirstSelection =
  | RepeatedTransitionFailureFirstSelection
  | RepeatedStateFailureFirstSelection
  | NoProgressFailureFirstSelection;

const ELIGIBLE_STATUSES: ReadonlySet<TraceSessionStatus> = new Set([
  "exception",
  "trace_limit",
  "timeout"
]);

interface CommonCandidateFields {
  evidenceStartIndex: number;
  evidenceEndIndex: number;
  distanceFromTermination: number;
}

function commonCandidateFields(
  rawTraceLength: number,
  pattern: BehavioralPattern,
  evidence: ResolvedBehavioralEvidence | undefined
): CommonCandidateFields | null {
  if (!evidence || evidence.patternId !== pattern.patternId) {
    return null;
  }
  if (!Number.isInteger(pattern.repeatCount) || pattern.repeatCount < MIN_PATTERN_REPEATS) {
    return null;
  }
  if (!Array.isArray(pattern.evidenceSteps) || !Array.isArray(evidence.evidenceSteps) || !Array.isArray(evidence.evidenceIndexes)) {
    return null;
  }
  if (evidence.evidenceSteps.length !== pattern.evidenceSteps.length ||
      evidence.evidenceIndexes.length !== pattern.evidenceSteps.length ||
      new Set(pattern.evidenceSteps).size !== pattern.evidenceSteps.length) {
    return null;
  }
  if (!evidence.evidenceSteps.every((step, index) => step === pattern.evidenceSteps[index])) {
    return null;
  }
  if (evidence.firstIndex === null || evidence.lastIndex === null ||
      !Number.isInteger(evidence.firstIndex) || !Number.isInteger(evidence.lastIndex)) {
    return null;
  }
  if (!evidence.evidenceIndexes.every(Number.isInteger)) {
    return null;
  }
  for (let index = 1; index < evidence.evidenceIndexes.length; index += 1) {
    if (evidence.evidenceIndexes[index]! <= evidence.evidenceIndexes[index - 1]!) {
      return null;
    }
  }
  if (evidence.evidenceIndexes.some((index) => index < 0 || index >= rawTraceLength)) {
    return null;
  }
  if (evidence.firstIndex !== evidence.evidenceIndexes[0] ||
      evidence.lastIndex !== evidence.evidenceIndexes.at(-1)) {
    return null;
  }

  const distanceFromTermination = rawTraceLength - 1 - evidence.lastIndex;
  if (distanceFromTermination < 0 || distanceFromTermination > FAILURE_FIRST_TERMINAL_WINDOW_STEPS) {
    return null;
  }

  return {
    evidenceStartIndex: evidence.firstIndex,
    evidenceEndIndex: evidence.lastIndex,
    distanceFromTermination
  };
}

function candidateFromPattern(
  rawTraceLength: number,
  pattern: BehavioralPattern,
  evidence: ResolvedBehavioralEvidence | undefined
): FailureFirstSelection | null {
  const common = commonCandidateFields(rawTraceLength, pattern, evidence);
  if (!common) {
    return null;
  }

  const base = {
    patternId: pattern.patternId,
    inspectIndex: common.evidenceEndIndex,
    evidenceStartIndex: common.evidenceStartIndex,
    evidenceEndIndex: common.evidenceEndIndex,
    distanceFromTermination: common.distanceFromTermination,
    repeatCount: pattern.repeatCount,
    reason: "nearest_terminal_evidence" as const
  };

  switch (pattern.kind) {
    case "repeated_state":
      return { ...base, kind: "repeated_state" };
    case "no_progress":
      return { ...base, kind: "no_progress", revisitCount: pattern.revisitCount };
    case "repeated_transition": {
      if (!Number.isInteger(pattern.periodSteps) || pattern.periodSteps <= 0 || !evidence) {
        return null;
      }
      if (evidence.evidenceIndexes.length !== pattern.periodSteps * pattern.repeatCount) {
        return null;
      }
      const firstIndex = evidence.firstIndex!;
      if (!evidence.evidenceIndexes.every((index, offset) => index === firstIndex + offset)) {
        return null;
      }

      const inspectIndex = common.evidenceEndIndex - pattern.periodSteps + 1;
      const lastChunkStart = evidence.evidenceIndexes.length - pattern.periodSteps;
      if (evidence.evidenceIndexes[lastChunkStart] !== inspectIndex) {
        return null;
      }
      return { ...base, kind: "repeated_transition", periodSteps: pattern.periodSteps, inspectIndex };
    }
  }
}

function compareSelections(
  left: FailureFirstSelection,
  right: FailureFirstSelection
): number {
  const distance = left.distanceFromTermination - right.distanceFromTermination;
  if (distance !== 0) {
    return distance;
  }

  const leftSpan = left.evidenceEndIndex - left.evidenceStartIndex + 1;
  const rightSpan = right.evidenceEndIndex - right.evidenceStartIndex + 1;
  if (leftSpan !== rightSpan) {
    return rightSpan - leftSpan;
  }

  if (left.repeatCount !== right.repeatCount) {
    return right.repeatCount - left.repeatCount;
  }
  return left.patternId.localeCompare(right.patternId);
}

export function selectFailureFirstEvidence(
  status: TraceSessionStatus,
  rawTraceLength: number,
  patterns: readonly BehavioralPattern[],
  evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>
): FailureFirstSelection | null {
  if (!ELIGIBLE_STATUSES.has(status) || !Number.isInteger(rawTraceLength) || rawTraceLength <= 0) {
    return null;
  }

  const candidates = patterns.flatMap((pattern) => {
    const candidate = candidateFromPattern(
      rawTraceLength,
      pattern,
      evidenceByPatternId.get(pattern.patternId)
    );
    return candidate ? [candidate] : [];
  });

  candidates.sort(compareSelections);
  return candidates[0] ?? null;
}
