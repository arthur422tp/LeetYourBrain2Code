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
import { createMatrixPathTracker } from "./matrix-path";
import type {
  ExpressionBatch,
  ExpressionEvidenceByStep,
  ExpressionPlan
} from "../shared/expression-types";
import { buildDecisionEvidence } from "./decision-interpreter";
import type {
  ConditionPlan,
  DecisionBatch,
  DecisionEvidenceByStep,
  DecisionHistoryBySite,
  DecisionChainOccurrence
} from "../shared/decision-types";
import type { ControlFlowBatch, ControlFlowPlan } from "../shared/control-flow-types";
import {
  buildControlFlowEvidence,
  type ControlFlowInterpretation,
  type TraceTerminationContext
} from "./control-flow-interpreter";

export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
  behavioralAnalysis: BehavioralAnalysis;
  expressionEvidence: ExpressionEvidenceByStep;
  decisionEvidence: DecisionEvidenceByStep;
  decisionHistory: DecisionHistoryBySite;
  decisionChains: DecisionChainOccurrence[];
  controlFlow: ControlFlowInterpretation;
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
  expressionBatches: ExpressionBatch[] = [],
  conditionPlan?: ConditionPlan,
  decisionBatches: DecisionBatch[] = [],
  controlFlowPlan?: ControlFlowPlan,
  controlFlowBatches: ControlFlowBatch[] = [],
  termination?: TraceTerminationContext
): TraceInterpretation {
  const runtimeStates = reconstructStates(events);
  const expressionEvidence = buildExpressionEvidence(
    expressionPlan,
    expressionBatches,
    runtimeStates
  );
  const decisionInterpretation = buildDecisionEvidence(
    conditionPlan,
    decisionBatches,
    runtimeStates
  );
  const controlFlow = buildControlFlowEvidence(
    controlFlowPlan,
    controlFlowBatches,
    runtimeStates,
    termination
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
  const pathTracker = createMatrixPathTracker();
  const visualStates = runtimeStates.map((runtime, index) => {
    const visualState = buildVisualState(
      runtime,
      frameDiffs[index] ?? null,
      relations,
      objectDiffs[index] ?? null,
      mutationBatches[index]!.mutations,
      expressionEvidence.get(runtime.step)?.roots
        .flatMap((root) => root.structureReferences) ?? [],
      decisionInterpretation.byStep.get(runtime.step)?.structureReferences ?? [],
      (matrices) => {
        if (runtime.activeFrameId !== null) {
          pathTracker.update(runtime.activeFrameId, matrices, expressionEvidence.get(runtime.step)?.roots ?? []);
        }
      }
    );
    return visualState;
  });

  return {
    runtimeStates,
    frameDiffs,
    objectDiffs,
    mutationBatches,
    behavioralAnalysis,
    expressionEvidence,
    decisionEvidence: decisionInterpretation.byStep,
    decisionHistory: decisionInterpretation.historyBySite,
    decisionChains: decisionInterpretation.chains,
    controlFlow,
    visualStates
  };
}

export const interpretTraceEvents = interpretTrace;
