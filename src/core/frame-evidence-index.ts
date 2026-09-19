import type { CallFrameModel } from "../shared/call-frame-types";
import type { DecisionEvidenceByStep } from "../shared/decision-types";
import type { ExpressionEvidenceByStep } from "../shared/expression-types";
import type { TraceEvent } from "../shared/trace-types";
import type { ControlFlowInterpretation } from "./control-flow-interpreter";
import type { RuntimeMutationBatch } from "./runtime-mutation";

export interface FrameEvidenceEntry {
  frameId: number;
  childFrameIds: number[];
  decisionAnchors: number[];
  controlFlowIterationRefs: Array<{
    loopId: string;
    iteration: number;
    anchorStepStart: number;
  }>;
  expressionAnchors: number[];
  mutationAnchors: number[];
}

export type FrameEvidenceIndex = Map<number, FrameEvidenceEntry>;

export interface FrameEvidenceIndexInput {
  callFrames: CallFrameModel;
  events: TraceEvent[];
  decisionEvidence: DecisionEvidenceByStep;
  controlFlow: ControlFlowInterpretation;
  expressionEvidence: ExpressionEvidenceByStep;
  mutationBatches: RuntimeMutationBatch[];
}

function appendUnique(values: number[], value: number): void {
  if (!values.includes(value)) values.push(value);
}

function createEntry(frameId: number, childFrameIds: number[]): FrameEvidenceEntry {
  return {
    frameId,
    childFrameIds: [...childFrameIds],
    decisionAnchors: [],
    controlFlowIterationRefs: [],
    expressionAnchors: [],
    mutationAnchors: []
  };
}

export function buildFrameEvidenceIndex(input: FrameEvidenceIndexInput): FrameEvidenceIndex {
  const index: FrameEvidenceIndex = new Map();
  for (const [frameId, frame] of input.callFrames.byFrameId) {
    index.set(frameId, createEntry(frameId, frame.childFrameIds));
  }

  for (const evidence of input.decisionEvidence.values()) {
    const entry = index.get(evidence.frameId);
    if (entry) appendUnique(entry.decisionAnchors, evidence.anchorStep);
  }

  for (const iteration of input.controlFlow.iterations) {
    const entry = index.get(iteration.frameId);
    if (!entry) continue;
    const alreadyIndexed = entry.controlFlowIterationRefs.some(
      (reference) => reference.loopId === iteration.loopId &&
        reference.iteration === iteration.iteration &&
        reference.anchorStepStart === iteration.anchorStepStart
    );
    if (!alreadyIndexed) {
      entry.controlFlowIterationRefs.push({
        loopId: iteration.loopId,
        iteration: iteration.iteration,
        anchorStepStart: iteration.anchorStepStart
      });
    }
  }

  for (const evidence of input.expressionEvidence.values()) {
    const entry = index.get(evidence.frameId);
    if (entry) appendUnique(entry.expressionAnchors, evidence.anchorStep);
  }

  for (const batch of input.mutationBatches) {
    if (batch.frameId === null || batch.mutations.length === 0) continue;
    const entry = index.get(batch.frameId);
    if (entry) appendUnique(entry.mutationAnchors, batch.step);
  }

  // The raw trace remains the authoritative source for frame identity. The
  // index is intentionally keyed only by already-interpreted call frames;
  // raw events are accepted here to keep that boundary explicit without
  // synthesizing entries for frames absent from CallFrameModel.
  void input.events;
  return index;
}
