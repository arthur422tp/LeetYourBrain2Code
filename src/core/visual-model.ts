import type { ExceptionInfo } from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";
import { resolvePointerBindings, type PointerBinding } from "./binding-resolver";
import { relationMatchesFrameScope, type StaticRelation } from "./ast-relations";
import type { ContainerDiff, FrameDiff } from "./state-diff";
import { selectPrimaryContainers } from "./primary-container-resolver";
import type { RuntimeState } from "./runtime-state";
import { cloneLocals, cloneValueSnapshot, valueSnapshotKey } from "./value-snapshot";

export interface ListVisualModel {
  kind: "list";
  variableName: string;
  items: ValueSnapshot[];
  pointers: Array<{
    name: string;
    index: number;
    outOfBounds: boolean;
    source?: "subscript" | "iteration";
    valueVariable?: string;
  }>;
  changedIndexes: number[];
}

export interface DictVisualModel {
  kind: "dict";
  variableName: string;
  entries: Array<{
    key: ValueSnapshot;
    value: ValueSnapshot;
    status: "added" | "changed" | "unchanged";
  }>;
  probes?: Array<{
    keyVariable: string;
    key: ValueSnapshot;
    status: "hit" | "miss";
    operation: "membership" | "subscript";
  }>;
}

export type ContainerVisualModel = ListVisualModel | DictVisualModel;

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
  containerVisuals: ContainerVisualModel[];
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
        outOfBounds: binding.index < -snapshot.length || binding.index >= snapshot.length,
        ...(binding.source === "iteration"
          ? {
              source: binding.source,
              ...(binding.valueVariable ? { valueVariable: binding.valueVariable } : {})
            }
          : {})
      })),
    changedIndexes: changedIndexes(diff, primary)
  };
}

function buildDictVisual(
  runtime: RuntimeState,
  container: string,
  diff: FrameDiff | null,
  relations: StaticRelation[]
): DictVisualModel | null {
  if (runtime.activeFrameId === null) {
    return null;
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  const snapshot = frame?.locals[container];
  if (!frame || snapshot?.type !== "dict") {
    return null;
  }

  const containerChange = diff?.containerChanges.find(
    (change): change is Extract<ContainerDiff, { kind: "dict" }> =>
      change.container === container && change.kind === "dict"
  );
  const statusByKey = new Map<string, DictVisualModel["entries"][number]["status"]>();
  for (const change of containerChange?.changes ?? []) {
    if (change.kind !== "removed") {
      statusByKey.set(valueSnapshotKey(change.key), change.kind);
    }
  }

  const probes = relations
    .filter((relation) =>
      relation.kind !== "iteration" &&
      relation.container === container &&
      relationMatchesFrameScope(relation, frame.functionName) &&
      relation.line === runtime.currentLine
    )
    .map((relation) => {
      const key = frame.locals[relation.index];
      if (!key) {
        return null;
      }
      const hit = snapshot.entries.some((entry) => valueSnapshotKey(entry.key) === valueSnapshotKey(key));
      return {
        keyVariable: relation.index,
        key: cloneValueSnapshot(key),
        status: hit ? "hit" as const : "miss" as const,
        operation: relation.kind === "membership" ? "membership" as const : "subscript" as const
      };
    })
    .filter((probe): probe is NonNullable<typeof probe> => probe !== null)
    .filter((probe, index, all) => all.findIndex((candidate) =>
      candidate.keyVariable === probe.keyVariable &&
      candidate.operation === probe.operation &&
      valueSnapshotKey(candidate.key) === valueSnapshotKey(probe.key)
    ) === index);

  return {
    kind: "dict",
    variableName: container,
    entries: snapshot.entries.map((entry) => ({
      key: cloneValueSnapshot(entry.key),
      value: cloneValueSnapshot(entry.value),
      status: statusByKey.get(valueSnapshotKey(entry.key)) ?? "unchanged"
    })),
    ...(probes.length > 0 ? { probes } : {})
  };
}

function buildContainerVisual(
  runtime: RuntimeState,
  bindings: PointerBinding[],
  container: string,
  diff: FrameDiff | null,
  relations: StaticRelation[]
): ContainerVisualModel | null {
  const frame = runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
  const snapshot = frame?.locals[container];
  if (snapshot?.type === "list" || snapshot?.type === "tuple") {
    return buildListVisual(runtime, bindings, container, diff);
  }
  if (snapshot?.type === "dict") {
    return buildDictVisual(runtime, container, diff, relations);
  }
  return null;
}

export function buildVisualState(
  runtime: RuntimeState,
  diff: FrameDiff | null,
  relations: StaticRelation[]
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
  const containerNames = [
    ...(selection.primary === null ? [] : [selection.primary]),
    ...selection.secondary
  ];
  const containerVisuals = containerNames
    .map((container) => buildContainerVisual(runtime, bindings, container, diff, relations))
    .filter((visual): visual is ContainerVisualModel => visual !== null);
  const result: VisualState = {
    step: runtime.step,
    currentLine: runtime.currentLine,
    primaryVisual: buildListVisual(runtime, bindings, selection.primary, diff),
    containerVisuals,
    stateChanges: diff,
    locals: frame ? cloneLocals(frame.locals) : {},
    callStack: buildCallStack(runtime),
    stdout: runtime.stdout,
    ...(runtime.exception ? { exception: { ...runtime.exception, stack: [...runtime.exception.stack] } } : {})
  };
  return result;
}
