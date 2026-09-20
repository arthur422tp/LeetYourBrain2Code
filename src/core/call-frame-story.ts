import {
  frameCursorContextAt
} from "./call-frame-interpreter";
import type { FrameEvidenceIndex } from "./frame-evidence-index";
import type {
  BoundArgumentSnapshot,
  CallFrameModel,
  CallFrameTracingState,
  FrameExit,
  FunctionPlan,
  RecursionOccurrenceInfo
} from "../shared/call-frame-types";
import type { TraceEvent } from "../shared/trace-types";

export type FrameAtCursorStatus =
  | "not_started"
  | "active"
  | "exited"
  | "unknown";

export interface CallFrameEvidenceCounts {
  decisions: number;
  loopIterations: number;
  expressions: number;
  mutations: number;
}

export interface CallFrameStoryNode {
  frameId: number;
  functionId?: string;
  functionName: string;
  qualifiedName?: string;
  displayName: string;
  depth: number;
  arguments: BoundArgumentSnapshot[];
  callStep: number;
  firstUserLineStep?: number;
  exit: FrameExit;
  atCursor: FrameAtCursorStatus;
  recursion: RecursionOccurrenceInfo;
  childFrameIds: number[];
  evidenceCounts: CallFrameEvidenceCounts;
}

export interface CallFrameStoryModel {
  roots: number[];
  byFrameId: Map<number, CallFrameStoryNode>;
  currentFrameId?: number;
  currentPath: number[];
  tracingState: CallFrameTracingState;
}

export interface BuildCallFrameStoryInput {
  callFrames: CallFrameModel;
  frameEvidenceIndex: FrameEvidenceIndex;
  functionPlan?: FunctionPlan;
  events: TraceEvent[];
  currentRawIndex: number;
}

function currentStepAt(events: TraceEvent[], rawIndex: number): number | undefined {
  if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= events.length) {
    return undefined;
  }
  return events[rawIndex]?.step;
}

function statusAtStep(
  frame: { callStep: number; exit: FrameExit; frameId: number },
  currentStep: number | undefined,
  currentPath: Set<number>
): FrameAtCursorStatus {
  if (currentStep === undefined) return "unknown";
  if (currentStep < frame.callStep) return "not_started";

  if (frame.exit.status === "returned" || frame.exit.status === "exception") {
    return currentStep < frame.exit.step ? "active" : "exited";
  }

  if (frame.exit.status === "trace_ended") {
    if (frame.exit.step !== undefined) {
      return currentStep < frame.exit.step ? "active" : "exited";
    }
    return currentPath.has(frame.frameId) ? "active" : "unknown";
  }

  return "active";
}

function copyExit(exit: FrameExit): FrameExit {
  switch (exit.status) {
    case "returned":
      return { ...exit };
    case "exception":
      return { ...exit };
    case "trace_ended":
      return { ...exit };
    case "active":
      return { ...exit };
  }
}

function copyRecursion(recursion: RecursionOccurrenceInfo): RecursionOccurrenceInfo {
  return {
    ...recursion,
    ...(recursion.cycleFunctionIds
      ? { cycleFunctionIds: [...recursion.cycleFunctionIds] }
      : {})
  };
}

export function buildCallFrameStory(input: BuildCallFrameStoryInput): CallFrameStoryModel {
  const descriptors = new Map(
    input.functionPlan?.functions.map((descriptor) => [descriptor.functionId, descriptor])
  );
  const context = frameCursorContextAt(
    input.callFrames,
    input.events,
    input.currentRawIndex
  );
  const currentStep = currentStepAt(input.events, input.currentRawIndex);
  const currentPath = context.currentFrameId === undefined
    ? []
    : context.activeChildPath;
  const currentPathSet = new Set(currentPath);
  const byFrameId = new Map<number, CallFrameStoryNode>();

  for (const [frameId, frame] of input.callFrames.byFrameId) {
    const descriptor = frame.functionId === undefined
      ? undefined
      : descriptors.get(frame.functionId);
    const entry = input.frameEvidenceIndex.get(frameId);
    const displayName = descriptor?.qualifiedName || frame.functionName || "user function";
    byFrameId.set(frameId, {
      frameId,
      ...(frame.functionId !== undefined ? { functionId: frame.functionId } : {}),
      functionName: frame.functionName,
      ...(descriptor?.qualifiedName !== undefined ? { qualifiedName: descriptor.qualifiedName } : {}),
      displayName,
      depth: frame.depth,
      arguments: frame.arguments.map((argument) => ({
        ...argument,
        value: argument.value
      })),
      callStep: frame.callStep,
      ...(frame.firstUserLineStep !== undefined ? { firstUserLineStep: frame.firstUserLineStep } : {}),
      exit: copyExit(frame.exit),
      atCursor: statusAtStep(frame, currentStep, currentPathSet),
      recursion: copyRecursion(frame.recursion),
      childFrameIds: [...frame.childFrameIds],
      evidenceCounts: {
        decisions: entry?.decisionAnchors.length ?? 0,
        loopIterations: entry?.controlFlowIterationRefs.length ?? 0,
        expressions: entry?.expressionAnchors.length ?? 0,
        mutations: entry?.mutationAnchors.length ?? 0
      }
    });
  }

  return {
    roots: [...input.callFrames.roots],
    byFrameId,
    ...(context.currentFrameId !== undefined ? { currentFrameId: context.currentFrameId } : {}),
    currentPath,
    tracingState: { ...input.callFrames.tracingState }
  };
}
