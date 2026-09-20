import { buildCrossRunFunctionIdentityIndex } from "./cross-run-alignment";
import { projectCrossRunFrames } from "./cross-run-checkpoints";
import type {
  CrossRunCoverage,
  EvidenceCoverage,
  PreparedCrossRun
} from "./cross-run-diff-types";
import { interpretTraceSession } from "./trace-session-interpreter";
import type { TraceInterpretation } from "./trace-interpreter";
import type { TraceSession } from "../shared/trace-types";

export type {
  CrossRunCoverage,
  EvidenceCoverage,
  PreparedCrossRun
} from "./cross-run-diff-types";

function channelCoverage(
  state: { status: "complete" | "truncated" | "unavailable" } | undefined
): EvidenceCoverage {
  if (!state) return "unavailable";
  if (state.status === "complete") return "complete";
  if (state.status === "truncated") return "partial";
  return "unavailable";
}

function mutationCoverage(
  session: TraceSession,
  interpretation: TraceInterpretation
): "complete" | "partial" {
  if (interpretation.runtimeStates.length === 0) return "partial";
  if (session.status !== "completed" && session.status !== "exception") {
    return "partial";
  }
  return "complete";
}

function buildCoverage(
  session: TraceSession,
  interpretation: TraceInterpretation,
  skippedUnstableObjectMutations: number,
  incomparableMutationTargets: number
): CrossRunCoverage {
  return {
    callFrames: interpretation.callFrames.tracingState.status === "complete"
      ? "complete"
      : interpretation.callFrames.tracingState.status === "truncated"
        ? "partial"
        : "unavailable",
    decisions: channelCoverage(session.decisionTracing),
    expressions: channelCoverage(session.expressionTracing),
    controlFlow: channelCoverage(session.controlFlowTracing),
    mutations: {
      status: mutationCoverage(session, interpretation),
      skippedUnstableObjectMutations
    },
    values: { incomparableCount: incomparableMutationTargets }
  };
}

/**
 * Prepare one captured run without modifying its session or interpretation.
 * The returned maps and arrays are derived values and are retained by
 * convention as a cache snapshot while the run remains pinned.
 */
export function prepareCrossRun(
  session: TraceSession,
  suppliedInterpretation?: TraceInterpretation
): PreparedCrossRun {
  const interpretation = suppliedInterpretation ?? interpretTraceSession(session);
  const identities = buildCrossRunFunctionIdentityIndex(
    interpretation.callFrames,
    session.functionPlan
  );
  const projection = projectCrossRunFrames(session, interpretation, identities);

  return {
    session,
    interpretation,
    frames: projection.frames,
    roots: [...projection.roots],
    coverage: buildCoverage(
      session,
      interpretation,
      projection.coverage.skippedUnstableObjectMutations,
      projection.coverage.incomparableMutationTargets
    )
  };
}
