import type { ExceptionInfo } from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";
import { resolvePointerBindings, type PointerBinding } from "./binding-resolver";
import { relationMatchesFrameScope, type StaticRelation } from "./ast-relations";
import type { ObjectDiff } from "./object-diff";
import { buildLinkedListVisuals, type LinkedListVisualModel } from "./linked-list-interpreter";
import type { ContainerDiff, FrameDiff } from "./state-diff";
import { selectPrimaryContainers } from "./primary-container-resolver";
import type { RuntimeState } from "./runtime-state";
import { cloneLocals, cloneValueSnapshot, valueSnapshotKey } from "./value-snapshot";
import { resolveVisualCandidates, type VisualCandidate } from "./visual-candidate-resolver";

export interface ListVisualModel {
  kind: "list";
  visualId: string;
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
  visualId: string;
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

export type StructureVisualModel = ContainerVisualModel | LinkedListVisualModel;

export interface CallStackEntry {
  frameId: number;
  functionName: string;
  line: number | null;
  depth: number;
}

export interface VisualState {
  step: number;
  currentLine: number | null;
  visuals: StructureVisualModel[];
  primaryVisualId: string | null;
  objectChanges: ObjectDiff | null;
  /** @deprecated Use visuals and primaryVisualId. */
  primaryVisual: ListVisualModel | null;
  /** @deprecated Use visuals. */
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
  container: string,
  diff: FrameDiff | null
): ListVisualModel | null {
  if (runtime.activeFrameId === null) {
    return null;
  }
  const frame = runtime.frames.get(runtime.activeFrameId);
  const snapshot = frame?.locals[container];
  if (snapshot?.type !== "list" && snapshot?.type !== "tuple") {
    return null;
  }

  return {
    kind: "list",
    visualId: `list:${container}`,
    variableName: container,
    items: snapshot.items.map(cloneValueSnapshot),
    pointers: bindings
      .filter((binding) => binding.container === container)
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
    changedIndexes: changedIndexes(diff, container)
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
    visualId: `dict:${container}`,
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

function isSpecializedListCandidate(visual: StructureVisualModel): boolean {
  if (visual.kind !== "list") {
    return true;
  }
  return visual.items.every((item) =>
    item.type !== "list" &&
    item.type !== "tuple" &&
    item.type !== "dict" &&
    item.type !== "set"
  );
}

export function buildVisualState(
  runtime: RuntimeState,
  diff: FrameDiff | null,
  relations: StaticRelation[],
  objectDiff: ObjectDiff | null = null
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
  const linkedListVisuals = buildLinkedListVisuals(runtime, diff, objectDiff);
  const allVisuals: StructureVisualModel[] = [...containerVisuals, ...linkedListVisuals];
  const candidateVisuals = allVisuals.filter(isSpecializedListCandidate);
  const changedContainers = new Set(
    (diff?.frameId === runtime.activeFrameId ? diff.containerChanges : [])
      .map((change) => change.container)
  );
  const activeLineContainers = new Set(
    relations
      .filter((relation) =>
        relation.kind !== "membership" &&
        relation.line === runtime.currentLine &&
        frame !== undefined &&
        relationMatchesFrameScope(relation, frame.functionName)
      )
      .map((relation) => relation.container)
  );
  const visualCandidates: VisualCandidate[] = candidateVisuals.map((visual) => {
    if (visual.kind === "linked_list") {
      const pointerRelevant = visual.pointers.length > 0;
      const mutated = objectDiff !== null && (
        objectDiff.addedObjectIds.length > 0 ||
        objectDiff.removedObjectIds.length > 0 ||
        objectDiff.attributeChanges.length > 0
      );
      return {
        visualId: visual.visualId,
        kind: visual.kind,
        priority: [false, mutated, pointerRelevant, visual.pointers.length] as const
      };
    }
    const pointerRelevant = visual.kind === "list"
      ? visual.pointers.length > 0
      : (visual.probes?.length ?? 0) > 0;
    const mutated = changedContainers.has(visual.variableName) ||
      (visual.kind === "list" && visual.changedIndexes.length > 0);
    return {
      visualId: visual.visualId,
      kind: visual.kind,
      priority: [
        activeLineContainers.has(visual.variableName),
        mutated,
        pointerRelevant,
        visual.kind === "list" ? visual.pointers.length : 0
      ] as const
    };
  });
  const selectionResult = resolveVisualCandidates(visualCandidates);
  const visualById = new Map(candidateVisuals.map((visual) => [visual.visualId, visual]));
  const visuals = selectionResult.visible
    .map((candidate) => visualById.get(candidate.visualId))
    .filter((visual): visual is StructureVisualModel => visual !== undefined);
  const primaryVisual = selectionResult.primary
    ? visualById.get(selectionResult.primary.visualId)
    : undefined;
  const result: VisualState = {
    step: runtime.step,
    currentLine: runtime.currentLine,
    visuals,
    primaryVisualId: selectionResult.primary?.visualId ?? null,
    objectChanges: objectDiff,
    primaryVisual: primaryVisual?.kind === "list" ? primaryVisual : null,
    containerVisuals,
    stateChanges: diff,
    locals: frame ? cloneLocals(frame.locals) : {},
    callStack: buildCallStack(runtime),
    stdout: runtime.stdout,
    ...(runtime.exception ? { exception: { ...runtime.exception, stack: [...runtime.exception.stack] } } : {})
  };
  return result;
}
