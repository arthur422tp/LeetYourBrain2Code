import type { ExceptionInfo } from "../shared/execution-types";
import type { ValueSnapshot } from "../shared/trace-types";
import { resolvePointerBindings, type PointerBinding } from "./binding-resolver";
import { relationMatchesFrameScope, type StaticRelation } from "./ast-relations";
import type { ObjectDiff } from "./object-diff";
import { buildLinkedListVisuals, type LinkedListVisualModel } from "./linked-list-interpreter";
import { buildTreeVisuals, type TreeVisualModel } from "./tree-interpreter";
import type { FrameDiff } from "./state-diff";
import type { RuntimeState } from "./runtime-state";
import type {
  MappingEntryMutation,
  RuntimeMutation,
  SequenceElementMutation
} from "./runtime-mutation";
import { cloneRuntimeMutation } from "./runtime-mutation";
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

export type StructureVisualModel = ContainerVisualModel | LinkedListVisualModel | TreeVisualModel;

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
  stateChanges: FrameDiff | null;
  mutations: RuntimeMutation[];
  locals: Record<string, ValueSnapshot>;
  callStack: CallStackEntry[];
  stdout: string;
  exception?: ExceptionInfo;
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

function changedIndexes(
  mutations: RuntimeMutation[],
  frameId: number,
  container: string
): number[] {
  return mutations
    .filter((mutation): mutation is SequenceElementMutation =>
      mutation.kind === "sequence_element" &&
      mutation.frameId === frameId &&
      mutation.containerName === container
    )
    .map((mutation) => mutation.index)
    .filter((index, position, all) => all.indexOf(index) === position)
    .sort((left, right) => left - right);
}

function isContainerSnapshot(snapshot: ValueSnapshot | undefined): boolean {
  return snapshot?.type === "list" ||
    snapshot?.type === "tuple" ||
    snapshot?.type === "dict";
}

function buildListVisual(
  runtime: RuntimeState,
  bindings: PointerBinding[],
  container: string,
  mutations: RuntimeMutation[]
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
    changedIndexes: changedIndexes(mutations, frame!.frameId, container)
  };
}

function buildDictVisual(
  runtime: RuntimeState,
  container: string,
  mutations: RuntimeMutation[],
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

  const statusByKey = new Map<string, DictVisualModel["entries"][number]["status"]>();
  for (const mutation of mutations) {
    if (
      mutation.kind === "mapping_entry" &&
      mutation.frameId === frame.frameId &&
      mutation.containerName === container &&
      mutation.action !== "removed"
    ) {
      const mappingMutation = mutation as MappingEntryMutation;
      const status = mappingMutation.action === "added" ? "added" : "changed";
      statusByKey.set(valueSnapshotKey(mappingMutation.key), status);
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
  relations: StaticRelation[],
  mutations: RuntimeMutation[]
): ContainerVisualModel | null {
  const frame = runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
  const snapshot = frame?.locals[container];
  if (snapshot?.type === "list" || snapshot?.type === "tuple") {
    return buildListVisual(runtime, bindings, container, mutations);
  }
  if (snapshot?.type === "dict") {
    return buildDictVisual(runtime, container, mutations, relations);
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

function containerWasMutated(
  visual: ListVisualModel | DictVisualModel,
  frameId: number,
  mutations: RuntimeMutation[]
): boolean {
  return mutations.some((mutation) => {
    if (mutation.kind === "sequence_element") {
      return visual.kind === "list" &&
        mutation.frameId === frameId &&
        mutation.containerName === visual.variableName;
    }
    if (mutation.kind === "mapping_entry") {
      return visual.kind === "dict" &&
        mutation.frameId === frameId &&
        mutation.containerName === visual.variableName;
    }
    return false;
  });
}

function linkedListWasMutated(
  visual: LinkedListVisualModel,
  frameId: number,
  mutations: RuntimeMutation[]
): boolean {
  const objectIds = new Set(visual.nodes.map((node) => node.objectId));
  const pointerNames = new Set(visual.pointers.map((pointer) => pointer.variableName));

  return mutations.some((mutation) => {
    if (mutation.kind === "reference") {
      if (mutation.owner.scope === "local") {
        return mutation.owner.frameId === frameId &&
          pointerNames.has(mutation.owner.variableName);
      }
      return objectIds.has(mutation.owner.objectId);
    }
    if (mutation.kind === "object_attribute" || mutation.kind === "object_visibility") {
      return objectIds.has(mutation.objectId);
    }
    return false;
  });
}

function treeWasMutated(
  visual: TreeVisualModel,
  frameId: number,
  mutations: RuntimeMutation[]
): boolean {
  const objectIds = new Set(visual.nodes.map((node) => node.objectId));
  const pointerNames = new Set(visual.pointers.map((pointer) => pointer.variableName));

  return mutations.some((mutation) => {
    if (mutation.kind === "reference") {
      if (mutation.owner.scope === "local") {
        return mutation.owner.frameId === frameId &&
          pointerNames.has(mutation.owner.variableName);
      }
      return objectIds.has(mutation.owner.objectId);
    }
    if (mutation.kind === "object_attribute" || mutation.kind === "object_visibility") {
      return objectIds.has(mutation.objectId);
    }
    return false;
  });
}

export function buildVisualState(
  runtime: RuntimeState,
  diff: FrameDiff | null,
  relations: StaticRelation[],
  objectDiff: ObjectDiff | null = null,
  mutations: RuntimeMutation[] = []
): VisualState {
  const frame = runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
  const bindings = resolvePointerBindings(relations, runtime);
  const containerNames = frame
    ? Object.entries(frame.locals)
      .filter(([, snapshot]) => isContainerSnapshot(snapshot))
      .map(([name]) => name)
    : [];
  const containerVisuals = containerNames
    .map((container) => buildContainerVisual(runtime, bindings, container, relations, mutations))
    .filter((visual): visual is ContainerVisualModel => visual !== null);
  const linkedListVisuals = buildLinkedListVisuals(runtime, mutations);
  const treeVisuals = buildTreeVisuals(runtime, mutations);
  const allVisuals: StructureVisualModel[] = [
    ...containerVisuals,
    ...linkedListVisuals,
    ...treeVisuals
  ];
  const candidateVisuals = allVisuals.filter(isSpecializedListCandidate);
  const activeFrameId = frame?.frameId ?? -1;
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
      const mutated = linkedListWasMutated(visual, activeFrameId, mutations);
      return {
        visualId: visual.visualId,
        kind: visual.kind,
        priority: [false, mutated, pointerRelevant, visual.pointers.length] as const
      };
    }
    if (visual.kind === "tree") {
      const pointerRelevant = visual.pointers.length > 0;
      const mutated = treeWasMutated(visual, activeFrameId, mutations);
      return {
        visualId: visual.visualId,
        kind: visual.kind,
        priority: [false, mutated, pointerRelevant, visual.pointers.length] as const
      };
    }
    const pointerRelevant = visual.kind === "list"
      ? visual.pointers.length > 0
      : (visual.probes?.length ?? 0) > 0;
    const mutated = containerWasMutated(visual, activeFrameId, mutations);
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
  const result: VisualState = {
    step: runtime.step,
    currentLine: runtime.currentLine,
    visuals,
    primaryVisualId: selectionResult.primary?.visualId ?? null,
    objectChanges: objectDiff,
    stateChanges: diff,
    mutations: mutations.map(cloneRuntimeMutation),
    locals: frame ? cloneLocals(frame.locals) : {},
    callStack: buildCallStack(runtime),
    stdout: runtime.stdout,
    ...(runtime.exception ? { exception: { ...runtime.exception, stack: [...runtime.exception.stack] } } : {})
  };
  return result;
}
