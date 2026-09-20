import type {
  CrossRunDiffResult,
  CrossRunDivergence,
  CrossRunEvidenceAnchor
} from "../core/cross-run-diff";
import type { AlignmentConfidence } from "../core/cross-run-alignment";
import type { PreparedCrossRun } from "../core/cross-run-diff-types";
import type { ComparisonCompatibility } from "./run-comparison-state";
import type { ValueSnapshot } from "../shared/trace-types";

export interface BehavioralDiffSide {
  factualText: string;
  step?: number;
  source?: string;
  value?: ValueSnapshot;
}

export interface BehavioralDiffViewModel {
  summary: string;
  compatibility: ComparisonCompatibility;
  sourceDiffers: boolean;
  baselineLabel: string;
  currentLabel: string;
  matchedPrefix?: {
    frames: number;
    checkpoints: number;
    callPath: string[];
  };
  divergence?: {
    categoryLabel: string;
    locationLabel?: string;
    baseline?: BehavioralDiffSide;
    current?: BehavioralDiffSide;
    currentStep?: number;
    confidence: AlignmentConfidence;
  };
  coverageMessage?: string;
}

export interface BehavioralDiffViewLabels {
  baselineLabel?: string;
  currentLabel?: string;
}

const DIVERGENCE_LABELS: Record<CrossRunDivergence["kind"], string> = {
  frame_argument_changed: "Frame argument changed",
  child_call_changed: "Different child call observed",
  child_call_missing: "Child call missing from current run",
  child_call_extra: "Additional child call observed",
  decision_truth_changed: "Decision result changed",
  decision_outcome_changed: "Decision outcome changed",
  decision_completion_changed: "Decision evidence completion changed",
  decision_operand_changed: "Decision operand changed",
  decision_structure_changed: "Decision structure changed",
  expression_value_changed: "Expression value changed",
  expression_selection_changed: "Expression selection changed",
  expression_structure_changed: "Expression structure changed",
  loop_iteration_binding_changed: "Loop iteration binding changed",
  iteration_status_changed: "Loop iteration status changed",
  transfer_presence_changed: "Transfer evidence presence changed",
  transfer_status_changed: "Transfer status changed",
  loop_exit_reason_changed: "Loop exit reason changed",
  mutation_value_changed: "Mutation value changed",
  mutation_presence_changed: "Mutation evidence presence changed",
  frame_exit_status_changed: "Frame outcome changed",
  return_value_changed: "Return value changed",
  exception_type_changed: "Exception type changed",
  trace_end_reason_changed: "Trace end reason changed",
  session_outcome_changed: "Session outcome changed"
};

function compatibilitySummary(compatibility: ComparisonCompatibility): string | undefined {
  switch (compatibility.status) {
    case "compatible":
      return undefined;
    case "no_baseline":
      return "No baseline pinned.";
    case "no_current":
      return "Current run is not available yet.";
    case "same_run":
      return "Baseline is the current captured run.";
    case "missing_problem":
      return "Problem identity is unavailable for this comparison.";
    case "different_testcase":
      return "The current testcase differs from the pinned baseline.";
    case "different_problem":
      return "Baseline is for a different problem.";
    case "different_entrypoint":
      return "Baseline uses a different entrypoint.";
    case "unsupported_schema":
      return "Baseline comparison is unavailable for this trace schema.";
    case "unsupported_runtime":
      return "Baseline comparison is unavailable for this runtime.";
  }
}

export function divergenceCategoryLabel(kind: CrossRunDivergence["kind"]): string {
  return DIVERGENCE_LABELS[kind];
}

function sideFromAnchor(anchor: CrossRunEvidenceAnchor | undefined): BehavioralDiffSide | undefined {
  if (!anchor) return undefined;
  return {
    factualText: anchor.factualText,
    ...(anchor.step !== undefined ? { step: anchor.step } : {}),
    ...(anchor.source !== undefined ? { source: anchor.source } : {}),
    ...(anchor.value !== undefined ? { value: anchor.value } : {})
  };
}

function frameLabel(frameKey: string): string {
  if (frameKey.startsWith("fallback:")) return frameKey.slice("fallback:".length);
  try {
    const parsed = JSON.parse(frameKey) as { qualifiedName?: unknown };
    if (typeof parsed.qualifiedName === "string") return parsed.qualifiedName;
  } catch {
    // Stable keys are data, not user-authored source. Keep an opaque key readable.
  }
  return frameKey;
}

function authoritativeStep(
  anchor: CrossRunEvidenceAnchor | undefined,
  current: PreparedCrossRun | null
): number | undefined {
  if (!anchor || anchor.step === undefined || current === null) return undefined;
  return current.session.events.some((event) => event.step === anchor.step)
    ? anchor.step
    : undefined;
}

function coverageMessages(result: CrossRunDiffResult): string[] {
  const messages: string[] = [];
  if (result.stopReason === "coverage_ended") {
    messages.push("No divergence observed before comparison coverage ended.");
  } else if (result.stopReason === "ambiguous_alignment") {
    messages.push("Comparison stopped because the next evidence could not be aligned safely.");
  } else if (result.stopReason === "alignment_boundary") {
    messages.push("Comparison stopped because the next evidence could not be aligned safely.");
  } else if (result.stopReason === "unmatched_function") {
    messages.push("Comparison stopped because the next function occurrence could not be aligned safely.");
  }

  if (result.coverage.callFrames !== "complete") {
    messages.push(`Call-frame evidence is ${result.coverage.callFrames}.`);
  }
  if (result.coverage.decisions !== "complete") {
    messages.push(`Decision evidence is ${result.coverage.decisions}.`);
  }
  if (result.coverage.expressions !== "complete") {
    messages.push(`Expression evidence is ${result.coverage.expressions}.`);
  }
  if (result.coverage.controlFlow !== "complete") {
    messages.push(`Control-flow evidence is ${result.coverage.controlFlow}.`);
  }
  if (result.coverage.mutations.status !== "complete") {
    messages.push("Mutation evidence is partial.");
  }
  if (result.coverage.values.incomparableCount > 0) {
    messages.push(`${result.coverage.values.incomparableCount} value comparison(s) were not comparable across runs.`);
  }
  if (result.coverage.mutations.skippedUnstableObjectMutations > 0) {
    messages.push("Some object-owned mutations were excluded from cross-run alignment.");
  }
  return messages;
}

export function buildBehavioralDiffViewModel(
  baseline: PreparedCrossRun | null,
  current: PreparedCrossRun | null,
  result: CrossRunDiffResult,
  labels: BehavioralDiffViewLabels = {}
): BehavioralDiffViewModel {
  const compatibilityCopy = compatibilitySummary(result.compatibility);
  const sourceDiffers = baseline !== null
    && current !== null
    && baseline.session.sourceCode !== current.session.sourceCode;
  const model: BehavioralDiffViewModel = {
    summary: compatibilityCopy ?? "No behavioral divergence observed in comparable captured evidence.",
    compatibility: result.compatibility,
    sourceDiffers,
    baselineLabel: labels.baselineLabel ?? "Baseline · pinned run",
    currentLabel: labels.currentLabel ?? "Current · latest accepted run"
  };

  if (result.compatibility.status !== "compatible") {
    const messages = coverageMessages(result);
    if (messages.length > 0) model.coverageMessage = messages.join(" ");
    return model;
  }

  if (result.alignedPrefix.frameCount > 0 || result.alignedPrefix.checkpointCount > 0) {
    model.matchedPrefix = {
      frames: result.alignedPrefix.frameCount,
      checkpoints: result.alignedPrefix.checkpointCount,
      callPath: [...result.alignedPrefix.callPath]
    };
  }

  if (result.firstDivergence) {
    const divergence = result.firstDivergence;
    model.summary = `First observed divergence: ${divergenceCategoryLabel(divergence.kind)}`;
    model.divergence = {
      categoryLabel: divergenceCategoryLabel(divergence.kind),
      locationLabel: (divergence.current ?? divergence.baseline)
        ? `${frameLabel((divergence.current ?? divergence.baseline)!.frameKey)} · ${divergenceCategoryLabel(divergence.kind)}`
        : undefined,
      baseline: sideFromAnchor(divergence.baseline),
      current: sideFromAnchor(divergence.current),
      currentStep: authoritativeStep(divergence.current, current),
      confidence: divergence.alignmentConfidence
    };
  }

  const messages = coverageMessages(result);
  if (messages.length > 0) {
    model.coverageMessage = messages.join(" ");
  }
  if (!result.firstDivergence && result.stopReason === "coverage_ended") {
    model.summary = "No divergence observed before comparison coverage ended.";
  } else if (!result.firstDivergence && result.stopReason === undefined) {
    model.summary = "No behavioral divergence observed in comparable captured evidence.";
  }
  return model;
}

export const createBehavioralDiffViewModel = buildBehavioralDiffViewModel;
