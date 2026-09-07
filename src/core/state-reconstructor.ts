import type { ExceptionInfo } from "../shared/execution-types";
import type { TraceEvent, ValueSnapshot } from "../shared/trace-types";
import { cloneLocals, cloneValueSnapshot } from "./value-snapshot";
import type { FrameState, ObjectTopologyState, RuntimeState } from "./runtime-state";

export type { FrameState, RuntimeState } from "./runtime-state";

function cloneException(exception: ExceptionInfo): ExceptionInfo {
  return { ...exception, stack: [...exception.stack] };
}

function frameFromEvent(event: TraceEvent): FrameState {
  return {
    frameId: event.frameId,
    parentFrameId: event.parentFrameId,
    functionName: event.function,
    line: event.line,
    locals: cloneLocals(event.locals)
  };
}

function cloneFrame(frame: FrameState): FrameState {
  return {
    ...frame,
    locals: cloneLocals(frame.locals),
    ...(frame.returnValue !== undefined
      ? { returnValue: frame.returnValue === null ? null : cloneValueSnapshot(frame.returnValue) }
      : {}),
    ...(frame.exception ? { exception: cloneException(frame.exception) } : {})
  };
}

function cloneFrames(frames: Map<number, FrameState>): Map<number, FrameState> {
  return new Map([...frames.entries()].map(([frameId, frame]) => [frameId, cloneFrame(frame)]));
}

function objectTopologyFromEvent(event: TraceEvent): ObjectTopologyState {
  return {
    objects: new Map(
      (event.objects ?? []).map((object) => [
        object.objectId,
        {
          ...object,
          attributes: cloneLocals(object.attributes)
        }
      ])
    ),
    truncated: event.objectsTruncated ?? false
  };
}

function removeFrameFromStack(callStack: number[], frameId: number): number[] {
  const index = callStack.lastIndexOf(frameId);
  if (index === -1) {
    return callStack;
  }
  return callStack.slice(0, index);
}

function activateFrame(callStack: number[], frame: FrameState): number[] {
  const existingIndex = callStack.indexOf(frame.frameId);
  if (existingIndex >= 0) {
    return callStack.slice(0, existingIndex + 1);
  }

  const parentIndex = frame.parentFrameId === null
    ? -1
    : callStack.indexOf(frame.parentFrameId);
  if (parentIndex >= 0) {
    return [...callStack.slice(0, parentIndex + 1), frame.frameId];
  }
  return [...callStack, frame.frameId];
}

function eventException(event: TraceEvent): ExceptionInfo | undefined {
  if (event.event !== "exception" || event.eventPayload?.type !== "exception") {
    return undefined;
  }
  return cloneException(event.eventPayload.exception);
}

export function reconstructStates(events: TraceEvent[]): RuntimeState[] {
  const frames = new Map<number, FrameState>();
  let callStack: number[] = [];
  let activeFrameId: number | null = null;
  let currentLine: number | null = null;
  let stdout = "";
  const states: RuntimeState[] = [];

  for (const event of events) {
    let frame = frames.get(event.frameId);
    if (event.event === "call" || frame === undefined) {
      frame = frameFromEvent(event);
    } else {
      frame = {
        ...frame,
        parentFrameId: event.parentFrameId,
        functionName: event.function,
        line: event.line,
        locals: cloneLocals(event.locals),
        returnValue: undefined,
        exception: undefined
      };
    }

    if (event.event === "call") {
      frames.set(event.frameId, frame);
      callStack = activateFrame(callStack, frame);
    } else {
      callStack = activateFrame(callStack, frame);
      frames.set(event.frameId, frame);
    }

    activeFrameId = event.frameId;
    currentLine = event.line;
    stdout += event.stdoutDelta;

    const exception = eventException(event);
    if (exception) {
      frame.exception = exception;
      frames.set(event.frameId, frame);
    }
    if (event.event === "return" && event.eventPayload?.type === "return") {
      frame.returnValue = event.eventPayload.value === null
        ? null
        : cloneValueSnapshot(event.eventPayload.value);
      frames.set(event.frameId, frame);
    }

    states.push({
      step: event.step,
      activeFrameId,
      frames: cloneFrames(frames),
      callStack: [...callStack],
      currentLine,
      stdout,
      objectTopology: objectTopologyFromEvent(event),
      ...(exception ? { exception: cloneException(exception) } : {})
    });

    if (event.event === "return") {
      frames.delete(event.frameId);
      callStack = removeFrameFromStack(callStack, event.frameId);
      activeFrameId = callStack.at(-1) ?? null;
    }
  }

  return states;
}
