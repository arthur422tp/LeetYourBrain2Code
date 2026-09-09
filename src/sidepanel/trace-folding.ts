import type { BehavioralPattern, RepeatedTransitionPattern } from "../core/behavioral-pattern";
import type { ResolvedBehavioralEvidence } from "./behavioral-navigation";

export interface RawTraceRangeSegment { kind: "raw_range"; segmentId: string; startIndex: number; endIndex: number; }
export interface RepeatedTransitionIteration { iteration: number; startIndex: number; endIndex: number; }
export interface RepeatedTransitionFoldSegment { kind: "repeated_transition_fold"; segmentId: string; patternId: string; startIndex: number; endIndex: number; periodSteps: number; repeatCount: number; iterations: RepeatedTransitionIteration[]; }
export type TracePresentationSegment = RawTraceRangeSegment | RepeatedTransitionFoldSegment;
export interface TraceFoldModel { segments: TracePresentationSegment[]; foldedPatternIds: readonly string[]; }

interface FoldCandidate {
  patternId: string;
  startIndex: number;
  endIndex: number;
  periodSteps: number;
  repeatCount: number;
  iterations: RepeatedTransitionIteration[];
}

function contiguous(indexes: readonly number[]): boolean {
  if (indexes.length === 0) return false;
  const first = indexes[0]!;
  return indexes.every((value, offset) => value === first + offset);
}

function candidateFromPattern(rawTraceLength: number, pattern: RepeatedTransitionPattern, evidence: ResolvedBehavioralEvidence | undefined): FoldCandidate | null {
  if (!evidence || !Number.isInteger(pattern.periodSteps) || pattern.periodSteps <= 0 || !Number.isInteger(pattern.repeatCount) || pattern.repeatCount < 3) return null;
  if (evidence.patternId !== pattern.patternId || evidence.firstIndex === null || evidence.lastIndex === null) return null;
  if (evidence.evidenceSteps.length !== pattern.evidenceSteps.length || !evidence.evidenceSteps.every((step, i) => step === pattern.evidenceSteps[i])) return null;
  if (evidence.evidenceSteps.length !== evidence.evidenceIndexes.length || new Set(pattern.evidenceSteps).size !== pattern.evidenceSteps.length) return null;
  if (!Number.isInteger(evidence.firstIndex) || !Number.isInteger(evidence.lastIndex)) return null;
  if (evidence.evidenceIndexes.length !== pattern.periodSteps * pattern.repeatCount || !evidence.evidenceIndexes.every(Number.isInteger) || !contiguous(evidence.evidenceIndexes)) return null;
  if (evidence.firstIndex !== evidence.evidenceIndexes[0] || evidence.lastIndex !== evidence.evidenceIndexes.at(-1)) return null;
  if (evidence.firstIndex < 0 || evidence.lastIndex >= rawTraceLength || evidence.lastIndex - evidence.firstIndex + 1 !== evidence.evidenceIndexes.length) return null;
  const iterations = Array.from({ length: pattern.repeatCount }, (_, zeroBased) => {
    const startIndex = evidence.firstIndex! + zeroBased * pattern.periodSteps;
    return { iteration: zeroBased + 1, startIndex, endIndex: startIndex + pattern.periodSteps - 1 };
  });
  return { patternId: pattern.patternId, startIndex: evidence.firstIndex, endIndex: evidence.lastIndex, periodSteps: pattern.periodSteps, repeatCount: pattern.repeatCount, iterations };
}

function candidateSpan(candidate: FoldCandidate): number { return candidate.endIndex - candidate.startIndex + 1; }

function normalizeSet(items: readonly FoldCandidate[]): FoldCandidate[] {
  return [...items].sort((a, b) => a.startIndex - b.startIndex || candidateSpan(b) - candidateSpan(a) || a.periodSteps - b.periodSteps || a.patternId.localeCompare(b.patternId));
}

function compareSets(left: readonly FoldCandidate[], right: readonly FoldCandidate[]): number {
  const leftCoverage = left.reduce((sum, item) => sum + candidateSpan(item), 0);
  const rightCoverage = right.reduce((sum, item) => sum + candidateSpan(item), 0);
  if (leftCoverage !== rightCoverage) return leftCoverage > rightCoverage ? 1 : -1;
  if (left.length !== right.length) return left.length < right.length ? 1 : -1;
  const a = normalizeSet(left), b = normalizeSet(right);
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!, y = b[i]!;
    if (x.startIndex !== y.startIndex) return x.startIndex < y.startIndex ? 1 : -1;
    if (candidateSpan(x) !== candidateSpan(y)) return candidateSpan(x) > candidateSpan(y) ? 1 : -1;
    if (x.periodSteps !== y.periodSteps) return x.periodSteps < y.periodSteps ? 1 : -1;
    const idOrder = x.patternId.localeCompare(y.patternId);
    if (idOrder !== 0) return idOrder < 0 ? 1 : -1;
  }
  return 0;
}

function selectNonOverlappingCandidates(candidates: readonly FoldCandidate[]): FoldCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.endIndex - b.endIndex || a.startIndex - b.startIndex || a.patternId.localeCompare(b.patternId));
  const best: FoldCandidate[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    let previous = -1;
    for (let j = i - 1; j >= 0; j -= 1) if (sorted[j]!.endIndex < current.startIndex) { previous = j; break; }
    const include = [...(previous >= 0 ? best[previous]! : []), current];
    const exclude = i > 0 ? best[i - 1]! : [];
    best[i] = compareSets(include, exclude) >= 0 ? include : exclude;
  }
  return normalizeSet(best.at(-1) ?? []);
}

export function buildTraceFoldModel(rawTraceLength: number, patterns: readonly BehavioralPattern[], evidenceByPatternId: ReadonlyMap<string, ResolvedBehavioralEvidence>): TraceFoldModel {
  if (rawTraceLength <= 0) return { segments: [], foldedPatternIds: [] };
  const candidates = patterns.flatMap((pattern) => pattern.kind === "repeated_transition" ? [candidateFromPattern(rawTraceLength, pattern, evidenceByPatternId.get(pattern.patternId))].filter((candidate): candidate is FoldCandidate => candidate !== null) : []);
  const selected = selectNonOverlappingCandidates(candidates);
  const segments: TracePresentationSegment[] = [];
  let cursor = 0;
  for (const candidate of selected) {
    if (cursor < candidate.startIndex) segments.push({ kind: "raw_range", segmentId: `raw:${cursor}:${candidate.startIndex - 1}`, startIndex: cursor, endIndex: candidate.startIndex - 1 });
    segments.push({ kind: "repeated_transition_fold", segmentId: `fold:${candidate.patternId}`, patternId: candidate.patternId, startIndex: candidate.startIndex, endIndex: candidate.endIndex, periodSteps: candidate.periodSteps, repeatCount: candidate.repeatCount, iterations: candidate.iterations });
    cursor = candidate.endIndex + 1;
  }
  if (cursor < rawTraceLength) segments.push({ kind: "raw_range", segmentId: `raw:${cursor}:${rawTraceLength - 1}`, startIndex: cursor, endIndex: rawTraceLength - 1 });
  return { segments, foldedPatternIds: selected.map((candidate) => candidate.patternId) };
}
