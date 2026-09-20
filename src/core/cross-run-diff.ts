import type {
  BehavioralCheckpoint,
  ChildCallCheckpoint,
  DecisionCheckpoint,
  ExpressionCheckpoint,
  FrameExitCheckpoint,
  LoopExitCheckpoint,
  LoopIterationCheckpoint,
  MutationCheckpoint,
  TransferCheckpoint
} from "./cross-run-checkpoints";
import {
  alignCrossRunFrames,
  type AlignedFramePair,
  type AlignmentConfidence
} from "./cross-run-alignment";
import {
  compareCrossRunValues,
  type CrossRunValueComparison
} from "./cross-run-value";
import type {
  CrossRunCoverage,
  PreparedCrossRun
} from "./cross-run-diff-types";
import type { ComparisonCompatibility } from "../sidepanel/run-comparison-state";
import type { BoundArgumentSnapshot, FrameExit } from "../shared/call-frame-types";
import type { ValueSnapshot } from "../shared/trace-types";

export const CROSS_RUN_ALIGNMENT_LOOKAHEAD = 8;

export type ComparisonStopReason =
  | "coverage_ended"
  | "ambiguous_alignment"
  | "alignment_boundary"
  | "unmatched_function";

export type CrossRunDivergenceKind =
  | "frame_argument_changed"
  | "child_call_changed"
  | "child_call_missing"
  | "child_call_extra"
  | "decision_truth_changed"
  | "decision_outcome_changed"
  | "decision_completion_changed"
  | "decision_operand_changed"
  | "decision_structure_changed"
  | "expression_value_changed"
  | "expression_selection_changed"
  | "expression_structure_changed"
  | "loop_iteration_binding_changed"
  | "iteration_status_changed"
  | "transfer_presence_changed"
  | "transfer_status_changed"
  | "loop_exit_reason_changed"
  | "mutation_value_changed"
  | "mutation_presence_changed"
  | "frame_exit_status_changed"
  | "return_value_changed"
  | "exception_type_changed"
  | "trace_end_reason_changed"
  | "session_outcome_changed";

export interface CrossRunEvidenceAnchor {
  frameKey: string;
  runLocalFrameId?: number;
  step?: number;
  source?: string;
  line?: number;
  value?: ValueSnapshot;
  factualText: string;
}

export interface CrossRunDivergence {
  kind: CrossRunDivergenceKind;
  baseline?: CrossRunEvidenceAnchor;
  current?: CrossRunEvidenceAnchor;
  alignmentConfidence: AlignmentConfidence;
  detail?: string;
}

export interface AlignedPrefixSummary {
  frameCount: number;
  checkpointCount: number;
  callPath: string[];
}

export interface CrossRunDiffResult {
  compatibility: ComparisonCompatibility;
  alignedPrefix: AlignedPrefixSummary;
  firstDivergence?: CrossRunDivergence;
  coverage: CrossRunCoverage;
  stopReason?: ComparisonStopReason;
}

interface ComparisonState {
  baseline: PreparedCrossRun;
  current: PreparedCrossRun;
  coverage: CrossRunCoverage;
  alignedPrefix: AlignedPrefixSummary;
  pairsByBaselineFrameId: Map<number, AlignedFramePair>;
  pairsByCurrentFrameId: Map<number, AlignedFramePair>;
}

interface WalkResult {
  divergence?: CrossRunDivergence;
  stopReason?: ComparisonStopReason;
  path?: string[];
}

function statusRank(status: "complete" | "partial" | "unavailable"): number {
  return status === "complete" ? 2 : status === "partial" ? 1 : 0;
}

function lowerCoverageStatus(
  left: "complete" | "partial" | "unavailable",
  right: "complete" | "partial" | "unavailable"
): "complete" | "partial" | "unavailable" {
  return statusRank(left) <= statusRank(right) ? left : right;
}

function lowerMutationStatus(left: "complete" | "partial", right: "complete" | "partial"):
  "complete" | "partial" {
  return left === "partial" || right === "partial" ? "partial" : "complete";
}

function mergeCoverage(baseline: CrossRunCoverage, current: CrossRunCoverage): CrossRunCoverage {
  return {
    callFrames: lowerCoverageStatus(baseline.callFrames, current.callFrames),
    decisions: lowerCoverageStatus(baseline.decisions, current.decisions),
    expressions: lowerCoverageStatus(baseline.expressions, current.expressions),
    controlFlow: lowerCoverageStatus(baseline.controlFlow, current.controlFlow),
    mutations: {
      status: lowerMutationStatus(baseline.mutations.status, current.mutations.status),
      skippedUnstableObjectMutations:
        baseline.mutations.skippedUnstableObjectMutations
        + current.mutations.skippedUnstableObjectMutations
    },
    values: {
      incomparableCount:
        baseline.values.incomparableCount + current.values.incomparableCount
    }
  };
}

function noteIncomparable(state: ComparisonState): void {
  state.coverage.values.incomparableCount += 1;
}

function checkpointCoverage(
  coverage: CrossRunCoverage,
  checkpoint: BehavioralCheckpoint
): "complete" | "partial" | "unavailable" {
  switch (checkpoint.kind) {
    case "decision":
      return coverage.decisions;
    case "expression":
      return coverage.expressions;
    case "loop_iteration":
    case "transfer":
    case "loop_exit":
      return coverage.controlFlow;
    case "mutation":
      return coverage.mutations.status;
    case "child_call":
      return coverage.callFrames;
  }
}

function valueText(value: ValueSnapshot | undefined): string {
  if (!value) return "unavailable";
  switch (value.type) {
    case "int":
    case "float":
    case "bool":
      return String(value.value);
    case "str":
      return JSON.stringify(value.value);
    case "none":
      return "None";
    case "list":
    case "tuple":
    case "dict":
    case "set":
      return `${value.type}(${value.length})`;
    case "reference":
      return `${value.className} reference`;
    case "unknown":
      return `${value.className} unknown`;
    case "cycle":
      return "cyclic value";
  }
}

function comparisonDetail(comparison: CrossRunValueComparison): string | undefined {
  if (comparison.status === "different") return comparison.detail;
  if (comparison.status === "incomparable") return comparison.reason;
  return undefined;
}

function anchor(
  frameKey: string,
  frameId: number | undefined,
  step: number | undefined,
  factualText: string,
  value?: ValueSnapshot,
  source?: string
): CrossRunEvidenceAnchor {
  return {
    frameKey,
    ...(frameId !== undefined ? { runLocalFrameId: frameId } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(source ? { source } : {}),
    ...(value !== undefined ? { value } : {}),
    factualText
  };
}

function checkpointAnchor(
  frame: PreparedCrossRun["frames"] extends Map<number, infer T> ? T : never,
  checkpoint: BehavioralCheckpoint,
  factualText: string,
  value?: ValueSnapshot
): CrossRunEvidenceAnchor {
  const source = "source" in checkpoint && typeof checkpoint.source === "string"
    ? checkpoint.source
    : undefined;
  return anchor(
    frame.functionIdentity.key,
    frame.frameId,
    checkpoint.runLocalAnchorStep,
    factualText,
    value,
    source
  );
}

function frameAnchor(
  frame: PreparedCrossRun["frames"] extends Map<number, infer T> ? T : never,
  factualText: string,
  value?: ValueSnapshot
): CrossRunEvidenceAnchor {
  return anchor(
    frame.functionIdentity.key,
    frame.frameId,
    frame.entry.runLocalAnchorStep,
    factualText,
    value
  );
}

function exitAnchor(
  frame: PreparedCrossRun["frames"] extends Map<number, infer T> ? T : never,
  exit: FrameExitCheckpoint,
  factualText: string,
  value?: ValueSnapshot
): CrossRunEvidenceAnchor {
  return anchor(
    frame.functionIdentity.key,
    frame.frameId,
    exit.runLocalAnchorStep,
    factualText,
    value
  );
}

function divergence(
  kind: CrossRunDivergenceKind,
  pair: AlignedFramePair,
  baseline?: CrossRunEvidenceAnchor,
  current?: CrossRunEvidenceAnchor,
  detail?: string
): CrossRunDivergence {
  return {
    kind,
    ...(baseline ? { baseline } : {}),
    ...(current ? { current } : {}),
    alignmentConfidence: pair.confidence,
    ...(detail ? { detail } : {})
  };
}

function compareOptionalValue(
  baseline: ValueSnapshot | undefined,
  current: ValueSnapshot | undefined
): CrossRunValueComparison {
  if (baseline === undefined && current === undefined) return { status: "equal" };
  if (baseline === undefined || current === undefined) {
    return { status: "different", detail: "value presence changed" };
  }
  return compareCrossRunValues(baseline, current);
}

function compareArguments(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>
): CrossRunDivergence | undefined {
  const baselineArguments = baselineFrame.entry.arguments;
  const currentArguments = currentFrame.entry.arguments;
  const count = Math.max(baselineArguments.length, currentArguments.length);
  for (let index = 0; index < count; index += 1) {
    const left = baselineArguments[index];
    const right = currentArguments[index];
    if (!left || !right || left.name !== right.name || left.kind !== right.kind) {
      return divergence(
        "frame_argument_changed",
        pair,
        frameAnchor(
          baselineFrame,
          `argument ${left?.name ?? index} = ${valueText(left?.value)}`,
          left?.value
        ),
        frameAnchor(
          currentFrame,
          `argument ${right?.name ?? index} = ${valueText(right?.value)}`,
          right?.value
        ),
        "argument binding changed"
      );
    }
    const comparison = compareCrossRunValues(left.value, right.value);
    if (comparison.status === "incomparable") {
      noteIncomparable(state);
      continue;
    }
    if (comparison.status === "different") {
      return divergence(
        "frame_argument_changed",
        pair,
        frameAnchor(baselineFrame, `argument ${left.name} = ${valueText(left.value)}`, left.value),
        frameAnchor(currentFrame, `argument ${right.name} = ${valueText(right.value)}`, right.value),
        comparison.detail
      );
    }
  }
  return undefined;
}

function compareOperands(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: DecisionCheckpoint,
  current: DecisionCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.operands.length !== current.operands.length) {
    return divergence(
      "decision_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, "decision operands changed"),
      checkpointAnchor(currentFrame, current, "decision operands changed"),
      "decision operand structure changed"
    );
  }
  for (let index = 0; index < baseline.operands.length; index += 1) {
    const left = baseline.operands[index]!;
    const right = current.operands[index]!;
    if (left.source !== right.source) {
      return divergence(
        "decision_structure_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `decision operand ${left.source}`),
        checkpointAnchor(currentFrame, current, `decision operand ${right.source}`),
        "decision operand source changed"
      );
    }
    const comparison = compareOptionalValue(left.value, right.value);
    if (comparison.status === "incomparable") {
      noteIncomparable(state);
    } else if (comparison.status === "different") {
      return divergence(
        "decision_operand_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `${left.source} = ${valueText(left.value)}`, left.value),
        checkpointAnchor(currentFrame, current, `${right.source} = ${valueText(right.value)}`, right.value),
        comparison.detail
      );
    }
  }
  return undefined;
}

function compareDecision(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: DecisionCheckpoint,
  current: DecisionCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.source !== current.source || baseline.siteKind !== current.siteKind) {
    return divergence(
      "decision_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision ${baseline.source}`),
      checkpointAnchor(currentFrame, current, `decision ${current.source}`),
      "decision source or site kind changed"
    );
  }
  if (baseline.status !== current.status) {
    return divergence(
      "decision_completion_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision ${baseline.status}`),
      checkpointAnchor(currentFrame, current, `decision ${current.status}`),
      "decision completion status changed"
    );
  }
  if (baseline.truth !== undefined && current.truth !== undefined && baseline.truth !== current.truth) {
    return divergence(
      "decision_truth_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision truth = ${baseline.truth}`),
      checkpointAnchor(currentFrame, current, `decision truth = ${current.truth}`),
      "decision truth changed"
    );
  }
  if ((baseline.truth === undefined) !== (current.truth === undefined)) {
    return divergence(
      "decision_completion_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision truth = ${String(baseline.truth)}`),
      checkpointAnchor(currentFrame, current, `decision truth = ${String(current.truth)}`),
      "decision truth availability changed"
    );
  }
  if (baseline.outcome !== current.outcome) {
    return divergence(
      "decision_outcome_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision outcome = ${String(baseline.outcome)}`),
      checkpointAnchor(currentFrame, current, `decision outcome = ${String(current.outcome)}`),
      "decision outcome changed"
    );
  }
  return compareOperands(state, pair, baselineFrame, currentFrame, baseline, current);
}

function compareSelections(
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: ExpressionCheckpoint,
  current: ExpressionCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.selections.length !== current.selections.length) {
    return divergence(
      "expression_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, "expression selection evidence changed"),
      checkpointAnchor(currentFrame, current, "expression selection evidence changed"),
      "selection evidence count changed"
    );
  }
  for (let index = 0; index < baseline.selections.length; index += 1) {
    const left = baseline.selections[index]!;
    const right = current.selections[index]!;
    if (
      left.function !== right.function
      || left.candidateExprIds.length !== right.candidateExprIds.length
      || left.selectedCandidateIndex !== right.selectedCandidateIndex
    ) {
      return divergence(
        "expression_selection_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `expression selected ${String(left.selectedCandidateIndex)}`),
        checkpointAnchor(currentFrame, current, `expression selected ${String(right.selectedCandidateIndex)}`),
        "expression selection changed"
      );
    }
  }
  return undefined;
}

function compareExpression(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: ExpressionCheckpoint,
  current: ExpressionCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.rootKind !== current.rootKind || baseline.source !== current.source) {
    return divergence(
      "expression_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `expression ${baseline.source}`),
      checkpointAnchor(currentFrame, current, `expression ${current.source}`),
      "expression source or role changed"
    );
  }
  if (baseline.status !== current.status) {
    return divergence(
      "expression_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `expression ${baseline.status}`),
      checkpointAnchor(currentFrame, current, `expression ${current.status}`),
      "expression completion status changed"
    );
  }
  const result = compareOptionalValue(baseline.result, current.result);
  if (result.status === "incomparable") {
    noteIncomparable(state);
  } else if (result.status === "different") {
    return divergence(
      "expression_value_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `expression = ${valueText(baseline.result)}`, baseline.result),
      checkpointAnchor(currentFrame, current, `expression = ${valueText(current.result)}`, current.result),
      result.detail
    );
  }
  return compareSelections(pair, baselineFrame, currentFrame, baseline, current);
}

function compareBindings(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: LoopIterationCheckpoint,
  current: LoopIterationCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.bindings.length !== current.bindings.length) {
    return divergence(
      "loop_iteration_binding_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, "loop binding set changed"),
      checkpointAnchor(currentFrame, current, "loop binding set changed"),
      "loop binding count changed"
    );
  }
  for (let index = 0; index < baseline.bindings.length; index += 1) {
    const left = baseline.bindings[index]!;
    const right = current.bindings[index]!;
    if (left.name !== right.name) {
      return divergence(
        "loop_iteration_binding_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `loop binding ${left.name}`),
        checkpointAnchor(currentFrame, current, `loop binding ${right.name}`),
        "loop binding name changed"
      );
    }
    const comparison = compareCrossRunValues(left.value, right.value);
    if (comparison.status === "incomparable") {
      noteIncomparable(state);
    } else if (comparison.status === "different") {
      return divergence(
        "loop_iteration_binding_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `${left.name} = ${valueText(left.value)}`, left.value),
        checkpointAnchor(currentFrame, current, `${right.name} = ${valueText(right.value)}`, right.value),
        comparison.detail
      );
    }
  }
  if (baseline.status !== current.status) {
    return divergence(
      "iteration_status_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `iteration ${baseline.status}`),
      checkpointAnchor(currentFrame, current, `iteration ${current.status}`),
      "iteration terminal status changed"
    );
  }
  return undefined;
}

function compareMutation(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: MutationCheckpoint,
  current: MutationCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.mutationKind !== current.mutationKind || baseline.targetKey !== current.targetKey) {
    return divergence(
      "mutation_presence_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `mutation ${baseline.targetKey}`),
      checkpointAnchor(currentFrame, current, `mutation ${current.targetKey}`),
      "mutation target changed"
    );
  }
  if (baseline.action !== current.action || baseline.referenceAction !== current.referenceAction) {
    return divergence(
      "mutation_value_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `mutation ${baseline.action}`),
      checkpointAnchor(currentFrame, current, `mutation ${current.action}`),
      "mutation action changed"
    );
  }
  const values: Array<[ValueSnapshot | undefined, ValueSnapshot | undefined, string]> = [
    [baseline.before, current.before, "before"],
    [baseline.after, current.after, "after"],
    [baseline.member, current.member, "member"]
  ];
  for (const [left, right, label] of values) {
    const comparison = compareOptionalValue(left, right);
    if (comparison.status === "incomparable") {
      noteIncomparable(state);
    } else if (comparison.status === "different") {
      return divergence(
        "mutation_value_changed",
        pair,
        checkpointAnchor(baselineFrame, baseline, `${label} = ${valueText(left)}`, left),
        checkpointAnchor(currentFrame, current, `${label} = ${valueText(right)}`, right),
        comparison.detail
      );
    }
  }
  return undefined;
}

function compareCheckpointPayload(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: BehavioralCheckpoint,
  current: BehavioralCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.kind !== current.kind) {
    return divergence(
      "mutation_presence_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `checkpoint ${baseline.kind}`),
      checkpointAnchor(currentFrame, current, `checkpoint ${current.kind}`),
      "checkpoint kind changed"
    );
  }
  switch (baseline.kind) {
    case "decision":
      return compareDecision(state, pair, baselineFrame, currentFrame, baseline, current as DecisionCheckpoint);
    case "expression":
      return compareExpression(state, pair, baselineFrame, currentFrame, baseline, current as ExpressionCheckpoint);
    case "loop_iteration":
      return compareBindings(state, pair, baselineFrame, currentFrame, baseline, current as LoopIterationCheckpoint);
    case "transfer": {
      const right = current as TransferCheckpoint;
      if (baseline.status !== right.status) {
        return divergence(
          "transfer_status_changed",
          pair,
          checkpointAnchor(baselineFrame, baseline, `transfer ${baseline.status}`),
          checkpointAnchor(currentFrame, right, `transfer ${right.status}`),
          "transfer status changed"
        );
      }
      return undefined;
    }
    case "loop_exit": {
      const right = current as LoopExitCheckpoint;
      if (baseline.reason !== right.reason) {
        return divergence(
          "loop_exit_reason_changed",
          pair,
          checkpointAnchor(baselineFrame, baseline, `loop exit ${baseline.reason}`),
          checkpointAnchor(currentFrame, right, `loop exit ${right.reason}`),
          "loop exit reason changed"
        );
      }
      return undefined;
    }
    case "mutation":
      return compareMutation(state, pair, baselineFrame, currentFrame, baseline, current as MutationCheckpoint);
    case "child_call":
      return undefined;
  }
}

function futureMatches(
  checkpoints: BehavioralCheckpoint[],
  semanticKey: string,
  start: number
): number[] {
  const matches: number[] = [];
  const end = Math.min(checkpoints.length, start + 1 + CROSS_RUN_ALIGNMENT_LOOKAHEAD);
  for (let index = start + 1; index < end; index += 1) {
    if (checkpoints[index]!.semanticKey === semanticKey) matches.push(index);
  }
  return matches;
}

function presenceKind(checkpoint: BehavioralCheckpoint, side: "baseline" | "current"): CrossRunDivergenceKind {
  if (checkpoint.kind === "child_call") return side === "baseline" ? "child_call_missing" : "child_call_extra";
  switch (checkpoint.kind) {
    case "decision":
      return "decision_completion_changed";
    case "expression":
      return "expression_structure_changed";
    case "loop_iteration":
      return "iteration_status_changed";
    case "transfer":
      return "transfer_presence_changed";
    case "loop_exit":
      return "loop_exit_reason_changed";
    case "mutation":
      return "mutation_presence_changed";
  }
}

function presenceDivergence(
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  checkpoint: BehavioralCheckpoint,
  side: "baseline" | "current"
): CrossRunDivergence {
  const kind = presenceKind(checkpoint, side);
  const text = `${side === "baseline" ? "baseline" : "current"} observed ${checkpoint.kind}`;
  return divergence(
    kind,
    pair,
    side === "baseline" ? checkpointAnchor(baselineFrame, checkpoint, text) : undefined,
    side === "current" ? checkpointAnchor(currentFrame, checkpoint, text) : undefined,
    "supported checkpoint presence changed"
  );
}

function presenceResult(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  checkpoint: BehavioralCheckpoint,
  observedSide: "baseline" | "current",
  path: string[]
): WalkResult {
  const missingSide = observedSide === "baseline" ? state.current : state.baseline;
  if (checkpointCoverage(missingSide.coverage, checkpoint) !== "complete") {
    return { stopReason: "coverage_ended", path };
  }
  return {
    divergence: presenceDivergence(
      pair,
      baselineFrame,
      currentFrame,
      checkpoint,
      observedSide
    ),
    path
  };
}

function structuralDivergence(
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  baseline: BehavioralCheckpoint,
  current: BehavioralCheckpoint
): CrossRunDivergence | undefined {
  if (baseline.kind === "decision" && current.kind === "decision") {
    return divergence(
      "decision_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `decision ${baseline.source}`),
      checkpointAnchor(currentFrame, current, `decision ${current.source}`),
      "decision semantic key changed"
    );
  }
  if (baseline.kind === "expression" && current.kind === "expression") {
    return divergence(
      "expression_structure_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `expression ${baseline.source}`),
      checkpointAnchor(currentFrame, current, `expression ${current.source}`),
      "expression semantic key changed"
    );
  }
  if (baseline.kind === "mutation" && current.kind === "mutation") {
    return divergence(
      "mutation_presence_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `mutation ${baseline.targetKey}`),
      checkpointAnchor(currentFrame, current, `mutation ${current.targetKey}`),
      "mutation target changed"
    );
  }
  if (baseline.kind === "child_call" && current.kind === "child_call") {
    return divergence(
      "child_call_changed",
      pair,
      checkpointAnchor(baselineFrame, baseline, `child call ${baseline.callee.displayName}`),
      checkpointAnchor(currentFrame, current, `child call ${current.callee.displayName}`),
      "child call target changed"
    );
  }
  return undefined;
}

function compareCheckpointStream(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  path: string[]
): WalkResult {
  const baselineCheckpoints = baselineFrame.checkpoints;
  const currentCheckpoints = currentFrame.checkpoints;
  let baselineIndex = 0;
  let currentIndex = 0;

  while (baselineIndex < baselineCheckpoints.length && currentIndex < currentCheckpoints.length) {
    const baselineCheckpoint = baselineCheckpoints[baselineIndex]!;
    const currentCheckpoint = currentCheckpoints[currentIndex]!;
    if (baselineCheckpoint.semanticKey !== currentCheckpoint.semanticKey) {
      const baselineFuture = futureMatches(
        baselineCheckpoints,
        currentCheckpoint.semanticKey,
        baselineIndex
      );
      const currentFuture = futureMatches(
        currentCheckpoints,
        baselineCheckpoint.semanticKey,
        currentIndex
      );
      if (baselineFuture.length > 1 || currentFuture.length > 1 || (baselineFuture.length === 1 && currentFuture.length === 1)) {
        return { stopReason: "ambiguous_alignment", path };
      }
      if (baselineFuture.length === 1 && currentFuture.length === 0) {
        return presenceResult(
          state,
          pair,
          baselineFrame,
          currentFrame,
          baselineCheckpoint,
          "baseline",
          path
        );
      }
      if (baselineFuture.length === 0 && currentFuture.length === 1) {
        return presenceResult(
          state,
          pair,
          baselineFrame,
          currentFrame,
          currentCheckpoint,
          "current",
          path
        );
      }
      const structural = structuralDivergence(
        pair,
        baselineFrame,
        currentFrame,
        baselineCheckpoint,
        currentCheckpoint
      );
      return structural
        ? { divergence: structural, path }
        : { stopReason: "alignment_boundary", path };
    }

    const payloadDivergence = compareCheckpointPayload(
      state,
      pair,
      baselineFrame,
      currentFrame,
      baselineCheckpoint,
      currentCheckpoint
    );
    if (payloadDivergence) return { divergence: payloadDivergence, path };
    state.alignedPrefix.checkpointCount += 1;

    if (baselineCheckpoint.kind === "child_call") {
      const baselineChildId = (baselineCheckpoint as ChildCallCheckpoint).childFrameId;
      const currentChildId = (currentCheckpoint as ChildCallCheckpoint).childFrameId;
      const childPair = state.pairsByBaselineFrameId.get(baselineChildId);
      if (!childPair || childPair.currentFrameId !== currentChildId) {
        return {
          divergence: divergence(
            "child_call_changed",
            pair,
            checkpointAnchor(baselineFrame, baselineCheckpoint, `child call ${(baselineCheckpoint as ChildCallCheckpoint).callee.displayName}`),
            checkpointAnchor(currentFrame, currentCheckpoint, `child call ${(currentCheckpoint as ChildCallCheckpoint).callee.displayName}`),
            "child frame alignment changed"
          ),
          path
        };
      }
      const childResult = compareFrame(state, childPair, path.concat(
        state.baseline.frames.get(baselineChildId)!.functionIdentity.displayName
      ));
      if (childResult.divergence || childResult.stopReason) return childResult;
    }
    baselineIndex += 1;
    currentIndex += 1;
  }

  if (baselineIndex < baselineCheckpoints.length) {
    return presenceResult(
      state,
      pair,
      baselineFrame,
      currentFrame,
      baselineCheckpoints[baselineIndex]!,
      "baseline",
      path
    );
  }
  if (currentIndex < currentCheckpoints.length) {
    return presenceResult(
      state,
      pair,
      baselineFrame,
      currentFrame,
      currentCheckpoints[currentIndex]!,
      "current",
      path
    );
  }
  return { path };
}

function exceptionText(exit: Extract<FrameExit, { status: "exception" }>): string {
  return `${exit.exception.type}: ${exit.exception.message}`;
}

function compareFrameExit(
  state: ComparisonState,
  pair: AlignedFramePair,
  baselineFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>,
  currentFrame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>
): CrossRunDivergence | undefined {
  const baselineExit = baselineFrame.exit.exit;
  const currentExit = currentFrame.exit.exit;
  if (baselineExit.status !== currentExit.status) {
    return divergence(
      "frame_exit_status_changed",
      pair,
      exitAnchor(baselineFrame, baselineFrame.exit, `frame ${baselineExit.status}`),
      exitAnchor(currentFrame, currentFrame.exit, `frame ${currentExit.status}`),
      "frame exit status changed"
    );
  }
  if (baselineExit.status === "returned" && currentExit.status === "returned") {
    const comparison = compareCrossRunValues(baselineExit.value, currentExit.value);
    if (comparison.status === "incomparable") {
      noteIncomparable(state);
    } else if (comparison.status === "different") {
      return divergence(
        "return_value_changed",
        pair,
        exitAnchor(baselineFrame, baselineFrame.exit, `returned ${valueText(baselineExit.value)}`, baselineExit.value),
        exitAnchor(currentFrame, currentFrame.exit, `returned ${valueText(currentExit.value)}`, currentExit.value),
        comparison.detail
      );
    }
  } else if (baselineExit.status === "exception" && currentExit.status === "exception") {
    if (baselineExit.exception.type !== currentExit.exception.type) {
      return divergence(
        "exception_type_changed",
        pair,
        exitAnchor(baselineFrame, baselineFrame.exit, exceptionText(baselineExit)),
        exitAnchor(currentFrame, currentFrame.exit, exceptionText(currentExit)),
        "exception type changed"
      );
    }
  } else if (baselineExit.status === "trace_ended" && currentExit.status === "trace_ended") {
    if (baselineExit.reason !== currentExit.reason) {
      return divergence(
        "trace_end_reason_changed",
        pair,
        exitAnchor(baselineFrame, baselineFrame.exit, `trace ended · ${baselineExit.reason}`),
        exitAnchor(currentFrame, currentFrame.exit, `trace ended · ${currentExit.reason}`),
        "trace end reason changed"
      );
    }
  }
  return undefined;
}

function hasIndependentSessionTerminationEvidence(session: PreparedCrossRun["session"]): boolean {
  return session.status !== "completed" || session.terminationReason !== "normal_return";
}

function frameExitComparisonBlocked(
  prepared: PreparedCrossRun,
  frame: NonNullable<ReturnType<PreparedCrossRun["frames"]["get"]>>
): boolean {
  return prepared.coverage.callFrames !== "complete"
    && frame.exit.exit.status === "trace_ended"
    && !hasIndependentSessionTerminationEvidence(prepared.session);
}

function compareFrame(
  state: ComparisonState,
  pair: AlignedFramePair,
  path: string[]
): WalkResult {
  const baselineFrame = state.baseline.frames.get(pair.baselineFrameId);
  const currentFrame = state.current.frames.get(pair.currentFrameId);
  if (!baselineFrame || !currentFrame) {
    return { stopReason: "alignment_boundary", path };
  }
  state.alignedPrefix.frameCount += 1;
  state.alignedPrefix.callPath = [...path];

  const argumentDivergence = compareArguments(state, pair, baselineFrame, currentFrame);
  if (argumentDivergence) return { divergence: argumentDivergence, path };

  const checkpointResult = compareCheckpointStream(state, pair, baselineFrame, currentFrame, path);
  if (checkpointResult.divergence || checkpointResult.stopReason) return checkpointResult;

  if (
    frameExitComparisonBlocked(state.baseline, baselineFrame)
    || frameExitComparisonBlocked(state.current, currentFrame)
  ) {
    return { stopReason: "coverage_ended", path };
  }

  const exitDivergence = compareFrameExit(state, pair, baselineFrame, currentFrame);
  if (exitDivergence) return { divergence: exitDivergence, path };
  return { path };
}

function lastObservedStep(session: PreparedCrossRun["session"]): number | undefined {
  return session.events.length > 0 ? session.events[session.events.length - 1]!.step : undefined;
}

function sessionOutcomeDivergence(state: ComparisonState): CrossRunDivergence | undefined {
  const baseline = state.baseline.session;
  const current = state.current.session;
  if (baseline.status === current.status && baseline.terminationReason === current.terminationReason) {
    return undefined;
  }
  return {
    kind: "session_outcome_changed",
    baseline: anchor(
      "session",
      undefined,
      lastObservedStep(baseline),
      `${baseline.status} · ${baseline.terminationReason}`
    ),
    current: anchor(
      "session",
      undefined,
      lastObservedStep(current),
      `${current.status} · ${current.terminationReason}`
    ),
    alignmentConfidence: "structural",
    detail: "captured session outcome changed"
  };
}

function hasCoverageBoundary(coverage: CrossRunCoverage): boolean {
  return coverage.callFrames !== "complete"
    || coverage.decisions !== "complete"
    || coverage.expressions !== "complete"
    || coverage.controlFlow !== "complete"
    || coverage.mutations.status !== "complete";
}

function emptyResult(
  compatibility: ComparisonCompatibility,
  baseline: PreparedCrossRun,
  current: PreparedCrossRun
): CrossRunDiffResult {
  return {
    compatibility,
    alignedPrefix: { frameCount: 0, checkpointCount: 0, callPath: [] },
    coverage: mergeCoverage(baseline.coverage, current.coverage)
  };
}

export function compareCrossRuns(
  baseline: PreparedCrossRun,
  current: PreparedCrossRun,
  compatibility: ComparisonCompatibility
): CrossRunDiffResult {
  const initial = emptyResult(compatibility, baseline, current);
  if (compatibility.status !== "compatible") return initial;

  const alignment = alignCrossRunFrames(
    baseline.interpretation.callFrames,
    current.interpretation.callFrames,
    baseline.session.functionPlan,
    current.session.functionPlan
  );
  if (alignment.stop?.reason === "ambiguous_fallback") {
    return { ...initial, stopReason: "ambiguous_alignment" };
  }

  const state: ComparisonState = {
    baseline,
    current,
    coverage: initial.coverage,
    alignedPrefix: { frameCount: 0, checkpointCount: 0, callPath: [] },
    pairsByBaselineFrameId: new Map(alignment.pairs.map((pair) => [pair.baselineFrameId, pair])),
    pairsByCurrentFrameId: new Map(alignment.pairs.map((pair) => [pair.currentFrameId, pair]))
  };

  const baselineModel = baseline.interpretation.callFrames;
  const rootPairs = alignment.pairs.filter((pair) => baselineModel.roots.includes(pair.baselineFrameId));
  if (rootPairs.length === 0 && alignment.stop) {
    return { ...initial, stopReason: "unmatched_function" };
  }

  for (const pair of rootPairs) {
    const path = [baseline.frames.get(pair.baselineFrameId)?.functionIdentity.displayName ?? pair.functionKey];
    const result = compareFrame(state, pair, path);
    if (result.divergence) {
      return {
        compatibility,
        alignedPrefix: state.alignedPrefix,
        firstDivergence: result.divergence,
        coverage: state.coverage
      };
    }
    if (result.stopReason) {
      return {
        compatibility,
        alignedPrefix: state.alignedPrefix,
        coverage: state.coverage,
        stopReason: result.stopReason
      };
    }
  }

  const outcomeDivergence = sessionOutcomeDivergence(state);
  if (outcomeDivergence) {
    return {
      compatibility,
      alignedPrefix: state.alignedPrefix,
      firstDivergence: outcomeDivergence,
      coverage: state.coverage
    };
  }

  if (alignment.stop?.reason === "unmatched_function") {
    return {
      compatibility,
      alignedPrefix: state.alignedPrefix,
      coverage: state.coverage,
      stopReason: "unmatched_function"
    };
  }
  return {
    compatibility,
    alignedPrefix: state.alignedPrefix,
    coverage: state.coverage,
    ...(hasCoverageBoundary(state.coverage) ? { stopReason: "coverage_ended" as const } : {})
  };
}
