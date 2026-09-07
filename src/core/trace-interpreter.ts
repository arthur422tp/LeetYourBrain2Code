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

export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  objectDiffs: ObjectDiff[];
  mutationBatches: RuntimeMutationBatch[];
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
  relations: StaticRelation[] = []
): TraceInterpretation {
  const runtimeStates = reconstructStates(events);
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
  const visualStates = runtimeStates.map((runtime, index) =>
    buildVisualState(
      runtime,
      frameDiffs[index] ?? null,
      relations,
      objectDiffs[index] ?? null,
      mutationBatches[index]!.mutations
    )
  );

  return { runtimeStates, frameDiffs, objectDiffs, mutationBatches, visualStates };
}

export const interpretTraceEvents = interpretTrace;
