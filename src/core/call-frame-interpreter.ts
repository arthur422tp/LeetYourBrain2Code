import type {
  CallFrameBatch,
  CallFrameModel,
  CallFrameRuntimeUpdate,
  CallFrameTracingState,
  FrameCursorContext,
  FrameOccurrence,
  FunctionPlan,
  RecursionOccurrenceInfo
} from "../shared/call-frame-types";
import type { TerminationReason } from "../shared/execution-types";
import type { TraceEvent } from "../shared/trace-types";

interface CallFrameInterpreterInput {
  events: TraceEvent[];
  functionPlan?: FunctionPlan;
  batches?: CallFrameBatch[];
  tracingState?: CallFrameTracingState;
  terminationReason: TerminationReason;
}

function tracingStateFor(input: CallFrameInterpreterInput): CallFrameTracingState {
  if (input.tracingState) {
    return { ...input.tracingState };
  }
  return input.batches && input.batches.length > 0
    ? { status: "complete" }
    : { status: "unavailable", reason: "call_frame_evidence_missing" };
}

function copyArguments(update: Extract<CallFrameRuntimeUpdate, { kind: "frame_enter" }>): FrameOccurrence["arguments"] {
  return update.arguments.map((argument) => ({
    ...argument,
    value: argument.value
  }));
}

function createOccurrence(update: Extract<CallFrameRuntimeUpdate, { kind: "frame_enter" }>): FrameOccurrence {
  return {
    frameId: update.frameId,
    ...(update.functionId ? { functionId: update.functionId } : {}),
    functionName: update.functionName,
    parentFrameId: update.parentFrameId,
    depth: update.depth,
    callStep: update.callStep,
    arguments: copyArguments(update),
    childFrameIds: [],
    recursion: { isRecursive: false, recursionDepth: 1 },
    exit: { status: "active" }
  };
}

function applyTerminalUpdate(frame: FrameOccurrence, update: CallFrameRuntimeUpdate): void {
  if (frame.exit.status !== "active") {
    return;
  }
  if (update.kind === "frame_return") {
    frame.exit = { status: "returned", step: update.exitStep, value: update.value };
    frame.exitEvidence = "observed";
  } else if (update.kind === "frame_exception") {
    frame.exit = { status: "exception", step: update.exitStep, exception: update.exception };
    frame.exitEvidence = "observed";
  } else if (update.kind === "frame_trace_ended") {
    frame.exit = {
      status: "trace_ended",
      ...(update.exitStep !== undefined ? { step: update.exitStep } : {}),
      reason: update.reason
    };
    frame.exitEvidence = "observed";
  }
}

function orderedUpdates(batches: CallFrameBatch[]): CallFrameRuntimeUpdate[] {
  return batches
    .map((batch, batchIndex) => ({ batch, batchIndex }))
    .sort((left, right) => left.batch.batchId - right.batch.batchId || left.batchIndex - right.batchIndex)
    .flatMap(({ batch }) =>
      batch.updates
        .map((update, updateIndex) => ({ update, updateIndex }))
        .sort((left, right) => left.update.updateId - right.update.updateId || left.updateIndex - right.updateIndex)
        .map(({ update }) => update)
    );
}

function parentChain(model: CallFrameModel, frameId: number): number[] {
  const frame = model.byFrameId.get(frameId);
  if (!frame) return [];

  const ancestors: number[] = [];
  const visited = new Set<number>([frameId]);
  let parentFrameId = frame.parentFrameId;
  while (parentFrameId !== null && !visited.has(parentFrameId)) {
    visited.add(parentFrameId);
    if (!model.byFrameId.has(parentFrameId)) break;
    ancestors.push(parentFrameId);
    parentFrameId = model.byFrameId.get(parentFrameId)!.parentFrameId;
  }
  return ancestors.reverse();
}

function recursionFor(model: CallFrameModel, frame: FrameOccurrence): RecursionOccurrenceInfo {
  if (!frame.functionId) {
    return { isRecursive: false, recursionDepth: 1 };
  }

  const ancestors = parentChain(model, frame.frameId);
  const matchingAncestors = ancestors.filter(
    (ancestorId) => model.byFrameId.get(ancestorId)?.functionId === frame.functionId
  );
  if (matchingAncestors.length === 0) {
    return { isRecursive: false, recursionDepth: 1 };
  }

  const repeatedAncestorFrameId = matchingAncestors[matchingAncestors.length - 1]!;
  const repeatedIndex = ancestors.indexOf(repeatedAncestorFrameId);
  const cycleFunctionIds = [...ancestors.slice(repeatedIndex), frame.frameId]
    .map((frameId) => model.byFrameId.get(frameId)?.functionId)
    .filter((functionId): functionId is string => typeof functionId === "string");
  return {
    isRecursive: true,
    recursionDepth: matchingAncestors.length + 1,
    repeatedAncestorFrameId,
    ...(cycleFunctionIds.length > 0 ? { cycleFunctionIds } : {})
  };
}

function attachTree(model: CallFrameModel, enterOrder: number[]): void {
  for (const frameId of enterOrder) {
    const frame = model.byFrameId.get(frameId)!;
    const parentId = frame.parentFrameId;
    const parent = parentId === null || parentId === frameId
      ? undefined
      : model.byFrameId.get(parentId);
    if (parent) {
      parent.childFrameIds.push(frameId);
    } else {
      model.roots.push(frameId);
    }
  }
}

function assignFirstUserLineSteps(model: CallFrameModel, events: TraceEvent[]): void {
  for (const event of events) {
    if (event.event !== "line") continue;
    const frame = model.byFrameId.get(event.frameId);
    if (frame && frame.firstUserLineStep === undefined) {
      frame.firstUserLineStep = event.step;
    }
  }
}

function projectUnclosedFrames(model: CallFrameModel, input: CallFrameInterpreterInput): void {
  const reason = input.tracingState?.reason ?? input.terminationReason;
  for (const frame of model.byFrameId.values()) {
    if (frame.exit.status === "active") {
      frame.exit = { status: "trace_ended", reason };
      frame.exitEvidence = "synthesized";
    }
  }
}

export function interpretCallFrames(input: CallFrameInterpreterInput): CallFrameModel {
  const model: CallFrameModel = {
    roots: [],
    byFrameId: new Map(),
    tracingState: tracingStateFor(input)
  };
  const enterOrder: number[] = [];

  for (const update of orderedUpdates(input.batches ?? [])) {
    if (update.kind === "frame_enter") {
      if (model.byFrameId.has(update.frameId)) continue;
      model.byFrameId.set(update.frameId, createOccurrence(update));
      enterOrder.push(update.frameId);
      continue;
    }
    const frame = model.byFrameId.get(update.frameId);
    if (!frame) continue;
    applyTerminalUpdate(frame, update);
  }

  attachTree(model, enterOrder);
  for (const frame of model.byFrameId.values()) {
    frame.recursion = recursionFor(model, frame);
  }
  assignFirstUserLineSteps(model, input.events);
  projectUnclosedFrames(model, input);
  return model;
}

export function frameCursorContextAt(
  model: CallFrameModel,
  events: TraceEvent[],
  rawIndex: number
): FrameCursorContext {
  if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= events.length) {
    return { ancestors: [], activeChildPath: [] };
  }
  const frameId = events[rawIndex]?.frameId;
  if (!frameId || !model.byFrameId.has(frameId)) {
    return { ancestors: [], activeChildPath: [] };
  }
  const ancestors = parentChain(model, frameId);
  return {
    currentFrameId: frameId,
    ancestors,
    activeChildPath: [...ancestors, frameId]
  };
}
