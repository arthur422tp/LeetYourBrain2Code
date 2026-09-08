import type { BehavioralObservation } from "./behavioral-observation";
import {
  BEHAVIOR_WINDOW_STEPS,
  EMPTY_BEHAVIORAL_ANALYSIS,
  MAX_PATTERNS_PER_TRACE,
  MIN_PATTERN_REPEATS,
  type BehavioralAnalysis,
  type BehavioralPattern,
  MAX_PATTERN_PERIOD,
  type NoProgressPattern,
  type RepeatedTransitionPattern,
  type RepeatedStatePattern
} from "./behavioral-pattern";

function patternId(
  kind: string,
  startStep: number,
  endStep: number,
  suffix: string
): string {
  return `${kind}:${startStep}:${endStep}:${suffix}`;
}

function eligibleCompleteObservation(
  observation: BehavioralObservation
): boolean {
  return observation.location !== null &&
    observation.locationKey !== null &&
    observation.stateFingerprint !== null &&
    observation.stateFingerprint.complete &&
    observation.normalizedStateKey !== null;
}

function repeatedStatePatterns(
  observations: BehavioralObservation[]
): RepeatedStatePattern[] {
  const candidates = new Map<string, Map<string, BehavioralObservation[]>>();

  for (const observation of observations) {
    if (!eligibleCompleteObservation(observation)) {
      continue;
    }
    const candidateKey = `${observation.locationKey}|${observation.stateFingerprint!.key}`;
    const exactGroups = candidates.get(candidateKey) ?? new Map<string, BehavioralObservation[]>();
    const group = exactGroups.get(observation.normalizedStateKey!) ?? [];
    group.push(observation);
    exactGroups.set(observation.normalizedStateKey!, group);
    candidates.set(candidateKey, exactGroups);
  }

  const patterns: RepeatedStatePattern[] = [];
  for (const exactGroups of candidates.values()) {
    for (const group of exactGroups.values()) {
      if (group.length < MIN_PATTERN_REPEATS) {
        continue;
      }
      const first = group[0]!;
      const last = group[group.length - 1]!;
      patterns.push({
        kind: "repeated_state",
        patternId: patternId(
          "repeated_state",
          first.step,
          last.step,
          first.stateFingerprint!.key
        ),
        startStep: first.step,
        endStep: last.step,
        repeatCount: group.length,
        evidenceSteps: group.map((entry) => entry.step),
        location: first.location!,
        stateFingerprintKey: first.stateFingerprint!.key
      });
    }
  }
  return patterns;
}

function noProgressPatterns(
  observations: BehavioralObservation[]
): NoProgressPattern[] {
  const runs = new Map<string, BehavioralObservation[]>();
  const patterns: NoProgressPattern[] = [];

  const finalize = (run: BehavioralObservation[]): void => {
    if (run.length < MIN_PATTERN_REPEATS) {
      return;
    }
    const first = run[0]!;
    const last = run[run.length - 1]!;
    patterns.push({
      kind: "no_progress",
      patternId: patternId("no_progress", first.step, last.step, first.locationKey!),
      startStep: first.step,
      endStep: last.step,
      repeatCount: run.length,
      revisitCount: run.length - 1,
      evidenceSteps: run.map((entry) => entry.step),
      location: first.location!
    });
  };

  for (const observation of observations) {
    if (observation.locationKey === null) {
      continue;
    }

    const previous = runs.get(observation.locationKey);
    if (!eligibleCompleteObservation(observation)) {
      if (previous) {
        finalize(previous);
        runs.delete(observation.locationKey);
      }
      continue;
    }

    if (!previous) {
      runs.set(observation.locationKey, [observation]);
      continue;
    }

    const last = previous[previous.length - 1]!;
    const sameState = last.stateFingerprint!.key === observation.stateFingerprint!.key &&
      last.normalizedStateKey === observation.normalizedStateKey;
    if (sameState) {
      previous.push(observation);
    } else {
      finalize(previous);
      runs.set(observation.locationKey, [observation]);
    }
  }

  for (const run of runs.values()) {
    finalize(run);
  }
  return patterns;
}

function sameEvidenceSpan(
  left: RepeatedTransitionPattern,
  right: RepeatedTransitionPattern
): boolean {
  return left.startStep === right.startStep &&
    left.endStep === right.endStep &&
    left.evidenceSteps.length === right.evidenceSteps.length &&
    left.evidenceSteps.every((step, index) => step === right.evidenceSteps[index]);
}

function repeatedTransitionPatterns(
  observations: BehavioralObservation[]
): RepeatedTransitionPattern[] {
  const maxPeriod = Math.min(
    MAX_PATTERN_PERIOD,
    Math.floor(observations.length / MIN_PATTERN_REPEATS)
  );
  const candidates: RepeatedTransitionPattern[] = [];

  for (let period = 1; period <= maxPeriod; period += 1) {
    let matchStart = -1;
    let matchCount = 0;

    const emitRun = (): void => {
      const requiredMatches = period * (MIN_PATTERN_REPEATS - 1);
      if (matchCount < requiredMatches || matchStart < period) {
        return;
      }

      const startIndex = matchStart - period;
      const totalLength = matchCount + period;
      const repeatCount = Math.floor(totalLength / period);
      const endIndex = startIndex + repeatCount * period - 1;
      if (repeatCount < MIN_PATTERN_REPEATS || endIndex >= observations.length) {
        return;
      }

      const evidence = observations.slice(startIndex, endIndex + 1);
      const motif = observations.slice(startIndex, startIndex + period);
      const motifKeys = motif.map((entry) => entry.transitionFingerprint.key);
      const startStep = evidence[0]!.step;
      const endStep = evidence[evidence.length - 1]!.step;
      candidates.push({
        kind: "repeated_transition",
        patternId: patternId(
          "repeated_transition",
          startStep,
          endStep,
          `${period}:${motifKeys.join(",")}`
        ),
        startStep,
        endStep,
        repeatCount,
        evidenceSteps: evidence.map((entry) => entry.step),
        periodSteps: period,
        motifKeys
      });
    };

    for (let index = period; index < observations.length; index += 1) {
      const current = observations[index]!;
      const previous = observations[index - period]!;
      const matches = current.transitionFingerprint.eligible &&
        previous.transitionFingerprint.eligible &&
        current.transitionFingerprint.key === previous.transitionFingerprint.key;

      if (matches) {
        if (matchCount === 0) {
          matchStart = index;
        }
        matchCount += 1;
      } else {
        emitRun();
        matchStart = -1;
        matchCount = 0;
      }
    }
    emitRun();
  }

  const longestByShape = new Map<string, RepeatedTransitionPattern>();
  for (const candidate of candidates) {
    const key = `${candidate.startStep}|${candidate.periodSteps}|${candidate.motifKeys.join("\u0000")}`;
    const existing = longestByShape.get(key);
    if (!existing || candidate.endStep > existing.endStep) {
      longestByShape.set(key, candidate);
    }
  }

  const byPeriod = [...longestByShape.values()].sort((left, right) =>
    left.periodSteps - right.periodSteps ||
    left.startStep - right.startStep ||
    right.endStep - left.endStep ||
    left.patternId.localeCompare(right.patternId)
  );
  const kept: RepeatedTransitionPattern[] = [];
  for (const candidate of byPeriod) {
    const coveredBySmallerPeriod = kept.some((existing) =>
      candidate.periodSteps > existing.periodSteps &&
      candidate.periodSteps % existing.periodSteps === 0 &&
      sameEvidenceSpan(candidate, existing)
    );
    if (!coveredBySmallerPeriod) {
      kept.push(candidate);
    }
  }
  return kept;
}

function sortPatterns(left: BehavioralPattern, right: BehavioralPattern): number {
  return left.startStep - right.startStep ||
    left.endStep - right.endStep ||
    left.kind.localeCompare(right.kind) ||
    left.patternId.localeCompare(right.patternId);
}

function withStepAnnotations(patterns: BehavioralPattern[]): BehavioralAnalysis {
  const patternIdsByStep = new Map<number, string[]>();
  for (const pattern of patterns) {
    for (const step of pattern.evidenceSteps) {
      const ids = patternIdsByStep.get(step) ?? [];
      ids.push(pattern.patternId);
      patternIdsByStep.set(step, ids);
    }
  }

  return {
    patterns,
    stepAnnotations: [...patternIdsByStep.entries()]
      .sort(([left], [right]) => left - right)
      .map(([step, patternIds]) => ({
        step,
        patternIds: [...patternIds].sort((left, right) => left.localeCompare(right))
      }))
  };
}

export function analyzeBehavioralPatterns(
  observations: BehavioralObservation[]
): BehavioralAnalysis {
  const window = observations.slice(-BEHAVIOR_WINDOW_STEPS);
  if (window.length === 0) {
    return { patterns: [], stepAnnotations: [] };
  }

  const patterns = [
    ...repeatedStatePatterns(window),
    ...noProgressPatterns(window),
    ...repeatedTransitionPatterns(window)
  ].sort(sortPatterns).slice(0, MAX_PATTERNS_PER_TRACE);
  return withStepAnnotations(patterns);
}

export function analyzeBehavioralPatternsSafely(
  observations: BehavioralObservation[]
): BehavioralAnalysis {
  try {
    return analyzeBehavioralPatterns(observations);
  } catch {
    return EMPTY_BEHAVIORAL_ANALYSIS;
  }
}
