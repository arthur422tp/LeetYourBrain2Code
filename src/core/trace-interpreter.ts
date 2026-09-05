import type { SubscriptRelation } from "./ast-relations";
import { diffFrameState, type FrameDiff } from "./state-diff";
import { reconstructStates, type RuntimeState } from "./state-reconstructor";
import { buildVisualState, type VisualState } from "./visual-model";
import type { FrameState } from "./runtime-state";
import type { TraceEvent } from "../shared/trace-types";

export interface TraceInterpretation {
  runtimeStates: RuntimeState[];
  frameDiffs: Array<FrameDiff | null>;
  visualStates: VisualState[];
}

function activeFrame(state: RuntimeState): FrameState | undefined {
  return state.activeFrameId === null
    ? undefined
    : state.frames.get(state.activeFrameId);
}

export function interpretTrace(
  events: TraceEvent[],
  relations: SubscriptRelation[] = []
): TraceInterpretation {
  const runtimeStates = reconstructStates(events);
  const previousFrameStates = new Map<number, FrameState>();
  const frameDiffs = runtimeStates.map((runtime) => {
    const currentFrame = activeFrame(runtime);
    if (!currentFrame) {
      return null;
    }
    const previousFrame = previousFrameStates.get(currentFrame.frameId);
    const diff = diffFrameState(previousFrame, currentFrame);
    previousFrameStates.set(currentFrame.frameId, currentFrame);
    return diff;
  });
  const visualStates = runtimeStates.map((runtime, index) =>
    buildVisualState(runtime, frameDiffs[index] ?? null, relations)
  );

  return { runtimeStates, frameDiffs, visualStates };
}

export const interpretTraceEvents = interpretTrace;
