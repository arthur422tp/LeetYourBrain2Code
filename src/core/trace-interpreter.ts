import type { StaticRelation } from "./ast-relations";
import { diffFrameState, type FrameDiff } from "./state-diff";
import { reconstructStates, type RuntimeState } from "./state-reconstructor";
import { buildVisualState, type VisualState } from "./visual-model";
import type { FrameState } from "./runtime-state";
import type { TraceEvent } from "../shared/trace-types";
import { diffObjectTopology, type ObjectDiff } from "./object-diff";
import type { ObjectTopologyState } from "./runtime-state";
import { normalizeRuntimeMutations } from "./runtime-mutation-normalizer";
import type { MutationOrigin, RuntimeMutationBatch } from "./runtime-mutation";
import {
  analyzeBehavioralPatternsSafely
} from "./behavioral-analyzer";
import {
  buildBehavioralObservations
} from "./behavioral-observation";
import type { BehavioralAnalysis } from "./behavioral-pattern";
import { buildExpressionEvidence } from "./expression-interpreter";
import type {
  ExpressionBatch,
  ExpressionEvidenceByStep,
  ExpressionPlan
} from "../shared/expression-types";

export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
  behavioralAnalysis: BehavioralAnalysis;
  expressionEvidence: ExpressionEvidenceByStep;
  visualStates: VisualState[];
}

const EMPTY_OBJECT_TOPOLOGY: ObjectTopologyState = {
  objects: new Map(),
  truncated: false
};

function activeFrame(state: RuntimeState): FrameState | undefined {
  return state.activeFrameId === null
    ? undefined
    : state.frames.get(state.activeFrameId);
}

export function interpretTrace(
  events: TraceEvent[],
  relations: StaticRelation[] = [],
  expressionPlan?: ExpressionPlan,
  expressionBatches: ExpressionBatch[] = []
): TraceInterpretation {
  const runtimeStates = reconstructStates(events);
  const expressionEvidence = buildExpressionEvidence(
    expressionPlan,
    expressionBatches,
    runtimeStates
  );
  const previousFrameStates = new Map<number, FrameState>();
  const frameResults = runtimeStates.map((runtime) => {
    const currentFrame = activeFrame(runtime);
    if (!currentFrame) {
      return { diff: null, origin: "transition" as MutationOrigin };
    }
    const previousFrame = previousFrameStates.get(currentFrame.frameId);
    const origin: MutationOrigin = previousFrame ? "transition" : "initial_snapshot";
    const diff = diffFrameState(previousFrame, currentFrame);
    previousFrameStates.set(currentFrame.frameId, currentFrame);
    return { diff, origin };
  });
  const frameDiffs = frameResults.map((result) => result.diff);
  const objectDiffs = runtimeStates.map((runtime, index) =>
    diffObjectTopology(
      index === 0 ? EMPTY_OBJECT_TOPOLOGY : runtimeStates[index - 1]!.objectTopology,
      runtime.objectTopology
    )
  );
  const mutationBatches = runtimeStates.map((runtime, index) => ({
    step: runtime.step,
    frameId: runtime.activeFrameId,
    currentLine: runtime.currentLine,
    mutations: normalizeRuntimeMutations({
      frameDiff: frameDiffs[index] ?? null,
      objectDiff: objectDiffs[index]!,
      frameOrigin: frameResults[index]!.origin,
      objectOrigin: index === 0 ? "initial_snapshot" : "transition"
    })
  }));
  const behavioralObservations = buildBehavioralObservations(
    runtimeStates,
    mutationBatches
  );
  const behavioralAnalysis = analyzeBehavioralPatternsSafely(behavioralObservations);
  const visualStates = runtimeStates.map((runtime, index) =>
    buildVisualState(
      runtime,
      frameDiffs[index] ?? null,
      relations,
      objectDiffs[index] ?? null,
      mutationBatches[index]!.mutations,
      expressionEvidence.get(runtime.step)?.roots
        .flatMap((root) => root.structureReferences) ?? []
    )
  );

  return {
    runtimeStates,
    frameDiffs,
    objectDiffs,
    mutationBatches,
    behavioralAnalysis,
    expressionEvidence,
    visualStates
  };
}

export const interpretTraceEvents = interpretTrace;
