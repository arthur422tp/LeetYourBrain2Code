import type { ExceptionInfo } from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";
import { resolvePointerBindings, type PointerBinding } from "./binding-resolver";
import type { SubscriptRelation } from "./ast-relations";
import type { FrameDiff } from "./state-diff";
import { selectPrimaryContainers } from "./primary-container-resolver";
import type { RuntimeState } from "./runtime-state";
import { cloneLocals, cloneValueSnapshot } from "./value-snapshot";

export interface ListVisualModel {
  kind: "list";
  variableName: string;
  items: ValueSnapshot[];
  pointers: Array<{
    name: string;
    index: number;
    outOfBounds: boolean;
  }>;
  changedIndexes: number[];
}

export interface CallStackEntry {
  frameId: number;
  functionName: string;
  line: number | null;
  depth: number;
}

export interface VisualState {
  step: number;
  currentLine: number | null;
  primaryVisual: ListVisualModel | null;
  stateChanges: FrameDiff | null;
  locals: Record<string, ValueSnapshot>;
  callStack: CallStackEntry[];
  stdout: string;
  exception?: ExceptionInfo;
}

function emptyDiff(frameId: number | null): FrameDiff {
  return { frameId: frameId ?? -1, variables: [], containerChanges: [] };
}

function buildCallStack(runtime: RuntimeState): CallStackEntry[] {
  return runtime.callStack.flatMap((frameId, index) => {
    const frame = runtime.frames.get(frameId);
    return frame
      ? [{
          frameId,
          functionName: frame.functionName,
          line: frame.line,
          depth: index + 1
        }]
      : [];
  });
}

function changedIndexes(diff: FrameDiff | null, container: string): number[] {
  const containerChange = diff?.containerChanges.find(
    (change) => change.container === container &&
      (change.kind === "list" || change.kind === "tuple")
  );
  if (
    !containerChange ||
    (containerChange.kind !== "list" && containerChange.kind !== "tuple")
  ) {
    return [];
  }
  return containerChange.changes.map((change) => change.index);
}

function buildListVisual(
  runtime: RuntimeState,
  bindings: PointerBinding[],
  primary: string | null,
  diff: FrameDiff | null
): ListVisualModel | null {
  if (primary === null || runtime.activeFrameId === null) {
    return null;
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  const snapshot = frame?.locals[primary];
  if (snapshot?.type !== "list" && snapshot?.type !== "tuple") {
    return null;
  }

  return {
    kind: "list",
    variableName: primary,
    items: snapshot.items.map(cloneValueSnapshot),
    pointers: bindings
      .filter((binding) => binding.container === primary)
      .map((binding) => ({
        name: binding.variable,
        index: binding.index,
        outOfBounds: binding.index < -snapshot.length || binding.index >= snapshot.length
      })),
    changedIndexes: changedIndexes(diff, primary)
  };
}

export function buildVisualState(
  runtime: RuntimeState,
  diff: FrameDiff | null,
  relations: SubscriptRelation[]
): VisualState {
  const frame = runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
  const bindings = resolvePointerBindings(relations, runtime);
  const selection = selectPrimaryContainers(
    runtime,
    bindings,
    diff ?? emptyDiff(runtime.activeFrameId),
    relations
  );
  const result: VisualState = {
    step: runtime.step,
    currentLine: runtime.currentLine,
    primaryVisual: buildListVisual(runtime, bindings, selection.primary, diff),
    stateChanges: diff,
    locals: frame ? cloneLocals(frame.locals) : {},
    callStack: buildCallStack(runtime),
    stdout: runtime.stdout,
    ...(runtime.exception ? { exception: { ...runtime.exception, stack: [...runtime.exception.stack] } } : {})
  };
  return result;
}
