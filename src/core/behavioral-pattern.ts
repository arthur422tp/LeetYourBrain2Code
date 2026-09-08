export const BEHAVIOR_WINDOW_STEPS = 256;
export const MIN_PATTERN_REPEATS = 3;
export const MAX_PATTERN_PERIOD = 32;
export const MAX_PATTERNS_PER_TRACE = 64;

export interface ExecutionLocation {
  frameId: number;
  functionName: string;
  line: number;
}

export interface BehavioralPatternBase {
  patternId: string;
  startStep: number;
  endStep: number;
  repeatCount: number;
  evidenceSteps: number[];
}

export interface RepeatedStatePattern extends BehavioralPatternBase {
  kind: "repeated_state";
  location: ExecutionLocation;
  stateFingerprintKey: string;
}

export interface NoProgressPattern extends BehavioralPatternBase {
  kind: "no_progress";
  location: ExecutionLocation;
  revisitCount: number;
}

export interface RepeatedTransitionPattern extends BehavioralPatternBase {
  kind: "repeated_transition";
  periodSteps: number;
  motifKeys: string[];
}

export type BehavioralPattern =
  | RepeatedStatePattern
  | NoProgressPattern
  | RepeatedTransitionPattern;

export interface BehavioralStepAnnotation {
  step: number;
  patternIds: string[];
}

export interface BehavioralAnalysis {
  patterns: BehavioralPattern[];
  stepAnnotations: BehavioralStepAnnotation[];
}

export const EMPTY_BEHAVIORAL_ANALYSIS: BehavioralAnalysis = {
  patterns: [],
  stepAnnotations: []
};
