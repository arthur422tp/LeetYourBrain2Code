import type { BehavioralPattern } from "../core/behavioral-pattern";

export interface TraceStepIndex {
  stepToIndex: ReadonlyMap<number, number>;
  indexToStep: readonly number[];
}

export interface ResolvedBehavioralEvidence {
  patternId: string;
  evidenceSteps: number[];
  evidenceIndexes: number[];
  firstIndex: number | null;
  lastIndex: number | null;
}

export function buildTraceStepIndex(steps: readonly number[]): TraceStepIndex {
  const stepToIndex = new Map<number, number>();
  const indexToStep = [...steps];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!Number.isFinite(step) || !Number.isInteger(step) || stepToIndex.has(step)) {
      continue;
    }
    stepToIndex.set(step, index);
  }

  return { stepToIndex, indexToStep };
}

export function resolveBehavioralEvidence(
  pattern: BehavioralPattern,
  traceIndex: TraceStepIndex
): ResolvedBehavioralEvidence {
  const byIndex = new Map<number, number>();

  for (const step of pattern.evidenceSteps) {
    const index = traceIndex.stepToIndex.get(step);
    if (index === undefined || byIndex.has(index)) {
      continue;
    }
    byIndex.set(index, step);
  }

  const entries = [...byIndex.entries()].sort(([left], [right]) => left - right);
  const evidenceIndexes = entries.map(([index]) => index);
  const evidenceSteps = entries.map(([, step]) => step);

  return {
    patternId: pattern.patternId,
    evidenceSteps,
    evidenceIndexes,
    firstIndex: evidenceIndexes[0] ?? null,
    lastIndex: evidenceIndexes.at(-1) ?? null
  };
}

export function resolveBehavioralEvidenceMap(
  patterns: readonly BehavioralPattern[],
  traceIndex: TraceStepIndex
): ReadonlyMap<string, ResolvedBehavioralEvidence> {
  return new Map(patterns.map((pattern) => [
    pattern.patternId,
    resolveBehavioralEvidence(pattern, traceIndex)
  ]));
}

export function previousEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null {
  for (let index = evidence.evidenceIndexes.length - 1; index >= 0; index -= 1) {
    const candidate = evidence.evidenceIndexes[index]!;
    if (candidate < currentIndex) {
      return candidate;
    }
  }
  return null;
}

export function nextEvidenceIndex(
  evidence: ResolvedBehavioralEvidence,
  currentIndex: number
): number | null {
  for (const candidate of evidence.evidenceIndexes) {
    if (candidate > currentIndex) {
      return candidate;
    }
  }
  return null;
}
