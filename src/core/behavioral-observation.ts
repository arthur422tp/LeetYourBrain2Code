import type { ExceptionInfo } from "../shared/execution-types";
import type { ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type { FrameState, RuntimeState } from "./runtime-state";
import type {
  ExecutionLocation
} from "./behavioral-pattern";
import type {
  RuntimeMutation,
  RuntimeMutationBatch
} from "./runtime-mutation";
import { isValueSnapshotComplete, valueSnapshotKey } from "./value-snapshot";

export interface StateFingerprint {
  key: string;
  complete: boolean;
}

export interface TransitionFingerprint {
  key: string;
  eligible: boolean;
}

export interface BehavioralObservation {
  step: number;
  frameId: number | null;
  functionName: string | null;
  currentLine: number | null;
  location: ExecutionLocation | null;
  locationKey: string | null;
  stateFingerprint: StateFingerprint | null;
  normalizedStateKey: string | null;
  transitionFingerprint: TransitionFingerprint;
  mutationCount: number;
}

function executionLocation(runtime: RuntimeState): ExecutionLocation | null {
  if (runtime.activeFrameId === null || runtime.currentLine === null) {
    return null;
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  if (!frame) {
    return null;
  }
  return {
    frameId: frame.frameId,
    functionName: frame.functionName,
    line: runtime.currentLine
  };
}

function locationKey(location: ExecutionLocation): string {
  return `${location.frameId}:${location.functionName}:${location.line}`;
}

function exceptionKey(exception: ExceptionInfo | undefined): unknown {
  if (!exception) {
    return null;
  }
  return {
    type: exception.type,
    message: exception.message,
    line: exception.line,
    stack: [...exception.stack],
    frameId: exception.frameId
  };
}

function snapshotKey(snapshot: ValueSnapshot | undefined): unknown {
  return snapshot === undefined ? { present: false } : {
    present: true,
    value: valueSnapshotKey(snapshot)
  };
}

function frameKey(frame: FrameState): unknown {
  return {
    frameId: frame.frameId,
    parentFrameId: frame.parentFrameId,
    functionName: frame.functionName,
    locals: Object.fromEntries(
      Object.entries(frame.locals)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, valueSnapshotKey(value)])
    ),
    returnValue: frame.returnValue === null
      ? { present: true, value: null }
      : snapshotKey(frame.returnValue),
    exception: exceptionKey(frame.exception)
  };
}

function missingFrameKey(frameId: number): unknown {
  return { frameId, missing: true };
}

function objectKey(object: ObjectSnapshot): unknown {
  return {
    objectId: object.objectId,
    className: object.className,
    attributes: Object.fromEntries(
      Object.entries(object.attributes)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => [name, valueSnapshotKey(value)])
    )
  };
}

function normalizedStateKey(runtime: RuntimeState): string {
  const callStack = runtime.callStack.map((frameId) => {
    const frame = runtime.frames.get(frameId);
    return frame ? frameKey(frame) : missingFrameKey(frameId);
  });
  const objects = [...runtime.objectTopology.objects.values()]
    .sort((left, right) => left.objectId.localeCompare(right.objectId))
    .map(objectKey);

  return JSON.stringify({
    activeFrameId: runtime.activeFrameId,
    callStack,
    objects,
    stdoutLength: runtime.stdout.length,
    exception: exceptionKey(runtime.exception)
  });
}

function runtimeStateIsComplete(runtime: RuntimeState): boolean {
  if (runtime.objectTopology.truncated) {
    return false;
  }

  for (const frameId of runtime.callStack) {
    const frame = runtime.frames.get(frameId);
    if (!frame) {
      return false;
    }
    if (!Object.values(frame.locals).every(isValueSnapshotComplete)) {
      return false;
    }
    if (
      frame.returnValue !== undefined &&
      frame.returnValue !== null &&
      !isValueSnapshotComplete(frame.returnValue)
    ) {
      return false;
    }
  }

  for (const object of runtime.objectTopology.objects.values()) {
    if (!Object.values(object.attributes).every(isValueSnapshotComplete)) {
      return false;
    }
  }
  return true;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function valueType(value: ValueSnapshot | undefined): string {
  return value?.type ?? "absent";
}

function mutationShapeKey(mutation: RuntimeMutation): string {
  switch (mutation.kind) {
    case "variable":
      return `variable:${mutation.variableName}:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "reference":
      return mutation.owner.scope === "local"
        ? `reference:local:${mutation.owner.variableName}:${mutation.action}`
        : `reference:object:*.${mutation.owner.attribute}:${mutation.action}`;
    case "sequence_element":
      return `sequence:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "mapping_entry":
      return `mapping:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "set_membership":
      return `set:${mutation.containerName}[*]:${mutation.action}:${valueType(mutation.member)}`;
    case "object_attribute":
      return `object_attribute:*.${mutation.attribute}:${mutation.action}:${valueType(mutation.before)}->${valueType(mutation.after)}`;
    case "object_visibility":
      return `object_visibility:*:${mutation.action}`;
  }
}

function transitionFingerprint(
  location: ExecutionLocation | null,
  mutations: RuntimeMutation[]
): TransitionFingerprint {
  if (mutations.some((mutation) => mutation.origin === "initial_snapshot")) {
    return {
      key: `${location ? locationKey(location) : "no-location"}|initialization`,
      eligible: false
    };
  }

  const shape = mutations.length === 0
    ? "none"
    : mutations.map(mutationShapeKey).join("+");
  return {
    key: `${location ? locationKey(location) : "no-location"}|${shape}`,
    eligible: true
  };
}

export function buildBehavioralObservations(
  runtimeStates: RuntimeState[],
  mutationBatches: RuntimeMutationBatch[]
): BehavioralObservation[] {
  return runtimeStates.map((runtime, index) => {
    const batch = mutationBatches[index];
    const mutations = batch?.mutations ?? [];
    const location = executionLocation(runtime);
    const stateKey = normalizedStateKey(runtime);
    return {
      step: runtime.step,
      frameId: runtime.activeFrameId,
      functionName: location?.functionName ?? null,
      currentLine: runtime.currentLine,
      location,
      locationKey: location ? locationKey(location) : null,
      stateFingerprint: {
        key: fnv1a(stateKey),
        complete: runtimeStateIsComplete(runtime)
      },
      normalizedStateKey: stateKey,
      transitionFingerprint: transitionFingerprint(location, mutations),
      mutationCount: mutations.length
    };
  });
}
