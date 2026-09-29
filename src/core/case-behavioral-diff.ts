import {
  compareCrossRuns,
  type CrossRunDiffResult
} from "./cross-run-diff";
import {
  prepareCrossRun,
  type PreparedCrossRun
} from "./cross-run-prepare";
import {
  compareRunCompatibility,
  type ComparisonCompatibility,
  type RunRecord
} from "../sidepanel/run-comparison-state";

export interface CaseBehavioralDiffResult {
  compatibility: ComparisonCompatibility;
  leftCaseIndex?: number;
  rightCaseIndex?: number;
  diff?: CrossRunDiffResult;
}

export interface CaseBehavioralDiffDependencies {
  prepareCrossRun?: typeof prepareCrossRun;
  compareCrossRuns?: typeof compareCrossRuns;
}

export function compareCaseBehavioralDiff(
  left: RunRecord | null,
  right: RunRecord | null,
  dependencies: CaseBehavioralDiffDependencies = {}
): CaseBehavioralDiffResult {
  const compatibility = compareRunCompatibility(left, right, "case_to_case");
  const result: CaseBehavioralDiffResult = {
    compatibility,
    leftCaseIndex: left?.context.selectedCaseIndex,
    rightCaseIndex: right?.context.selectedCaseIndex
  };

  if (compatibility.status !== "compatible" || left === null || right === null) {
    return result;
  }

  const prepare = dependencies.prepareCrossRun ?? prepareCrossRun;
  const compare = dependencies.compareCrossRuns ?? compareCrossRuns;
  const leftPrepared: PreparedCrossRun = prepare(left.session);
  const rightPrepared: PreparedCrossRun = prepare(right.session);

  return {
    ...result,
    diff: compare(leftPrepared, rightPrepared, compatibility)
  };
}
