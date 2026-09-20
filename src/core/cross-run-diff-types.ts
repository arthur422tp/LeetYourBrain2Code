import type { TraceInterpretation } from "./trace-interpreter";
import type { CrossRunFrameProjection } from "./cross-run-checkpoints";
import type { TraceSession } from "../shared/trace-types";

export type EvidenceCoverage = "complete" | "partial" | "unavailable";

export interface CrossRunMutationCoverage {
  status: "complete" | "partial";
  skippedUnstableObjectMutations: number;
}

export interface CrossRunCoverage {
  callFrames: EvidenceCoverage;
  decisions: EvidenceCoverage;
  expressions: EvidenceCoverage;
  controlFlow: EvidenceCoverage;
  mutations: CrossRunMutationCoverage;
  values: {
    incomparableCount: number;
  };
}

export interface PreparedCrossRun {
  session: TraceSession;
  interpretation: TraceInterpretation;
  frames: Map<number, CrossRunFrameProjection>;
  roots: number[];
  coverage: CrossRunCoverage;
}
