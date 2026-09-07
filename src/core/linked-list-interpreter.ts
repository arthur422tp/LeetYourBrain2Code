import type { FrameDiff } from "./state-diff";
import type { ObjectAttributeDiff, ObjectDiff } from "./object-diff";
import type { RuntimeState } from "./runtime-state";
import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import { cloneValueSnapshot, valueSnapshotsEqual } from "./value-snapshot";

export interface LinkedListNodeVisual {
  objectId: ObjectId;
  className: string;
  label: ValueSnapshot | null;
  nextObjectId: ObjectId | null;
  status: "unchanged" | "added" | "changed" | "detached";
  nextStatus: "unchanged" | "changed" | "added" | "removed";
}

export interface LinkedListPointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export interface LinkedListComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
}

export interface LinkedListVisualModel {
  kind: "linked_list";
  visualId: string;
  nodes: LinkedListNodeVisual[];
  components: LinkedListComponent[];
  pointers: LinkedListPointerVisual[];
  cyclic: boolean;
  truncated: boolean;
}

const EMPTY_OBJECT_DIFF: ObjectDiff = {
  addedObjectIds: [],
  removedObjectIds: [],
  attributeChanges: []
};

function activeFrame(runtime: RuntimeState) {
  return runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
}

function isReference(snapshot: ValueSnapshot | undefined): snapshot is Extract<ValueSnapshot, { type: "reference" }> {
  return snapshot?.type === "reference";
}

function isPrimitive(snapshot: ValueSnapshot): boolean {
  return snapshot.type === "int" ||
    snapshot.type === "float" ||
    snapshot.type === "bool" ||
    snapshot.type === "str" ||
    snapshot.type === "none";
}

function isStructuralObject(object: ObjectSnapshot): boolean {
  const next = object.attributes.next;
  return next?.type === "none" || next?.type === "reference";
}

function nodeLabel(object: ObjectSnapshot): ValueSnapshot | null {
  for (const name of ["val", "value", "data"]) {
    const snapshot = object.attributes[name];
    if (snapshot && snapshot.type !== "reference") {
      return cloneValueSnapshot(snapshot);
    }
  }

  const fallback = Object.entries(object.attributes)
    .filter(([name, snapshot]) => name !== "next" && isPrimitive(snapshot))
    .sort(([left], [right]) => left.localeCompare(right))[0]?.[1];
  return fallback ? cloneValueSnapshot(fallback) : null;
}

function sortedObjectIds(objects: Map<ObjectId, ObjectSnapshot>): ObjectId[] {
  return [...objects.keys()].sort((left, right) => left.localeCompare(right));
}

function componentData(
  candidates: Map<ObjectId, ObjectSnapshot>,
  nextTargets: Map<ObjectId, ObjectId | null>
): { components: LinkedListComponent[]; incoming: Map<ObjectId, number> } {
  const adjacency = new Map<ObjectId, Set<ObjectId>>();
  const incoming = new Map<ObjectId, number>();
  for (const objectId of candidates.keys()) {
    adjacency.set(objectId, new Set());
    incoming.set(objectId, 0);
  }

  for (const [objectId, target] of nextTargets) {
    if (target === null || !candidates.has(target)) {
      continue;
    }
    adjacency.get(objectId)!.add(target);
    adjacency.get(target)!.add(objectId);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }

  const visited = new Set<ObjectId>();
  const components: LinkedListComponent[] = [];
  for (const start of sortedObjectIds(candidates)) {
    if (visited.has(start)) {
      continue;
    }
    const queue = [start];
    const nodeIds: ObjectId[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      nodeIds.push(current);
      for (const neighbor of [...adjacency.get(current)!].sort()) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    nodeIds.sort((left, right) => left.localeCompare(right));
    components.push({
      componentId: `component:${nodeIds[0]}`,
      nodeIds,
      entryNodeIds: nodeIds.filter((objectId) => incoming.get(objectId) === 0)
    });
  }

  components.sort((left, right) => left.componentId.localeCompare(right.componentId));
  return { components, incoming };
}

function containsCycle(
  candidates: Map<ObjectId, ObjectSnapshot>,
  nextTargets: Map<ObjectId, ObjectId | null>
): boolean {
  const visiting = new Set<ObjectId>();
  const visited = new Set<ObjectId>();

  const visit = (objectId: ObjectId): boolean => {
    if (visiting.has(objectId)) {
      return true;
    }
    if (visited.has(objectId)) {
      return false;
    }
    visiting.add(objectId);
    const target = nextTargets.get(objectId);
    const cyclic = target !== null && target !== undefined && candidates.has(target)
      ? visit(target)
      : false;
    visiting.delete(objectId);
    visited.add(objectId);
    return cyclic;
  };

  return [...candidates.keys()].some((objectId) => visit(objectId));
}

function attributeChangesByObject(objectDiff: ObjectDiff): Map<ObjectId, ObjectAttributeDiff[]> {
  const changes = new Map<ObjectId, ObjectAttributeDiff[]>();
  for (const change of objectDiff.attributeChanges) {
    const list = changes.get(change.objectId) ?? [];
    list.push(change);
    changes.set(change.objectId, list);
  }
  return changes;
}

function detachedObjectIds(
  candidates: Map<ObjectId, ObjectSnapshot>,
  nextTargets: Map<ObjectId, ObjectId | null>,
  objectDiff: ObjectDiff
): Set<ObjectId> {
  const incoming = new Map<ObjectId, number>();
  for (const target of nextTargets.values()) {
    if (target !== null && candidates.has(target)) {
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }

  const detached = new Set<ObjectId>();
  for (const change of objectDiff.attributeChanges) {
    if (change.attribute !== "next" || !isReference(change.before)) {
      continue;
    }
    if (
      !isReference(change.after) ||
      !valueSnapshotsEqual(change.before, change.after)
    ) {
      if (candidates.has(change.before.objectId) && (incoming.get(change.before.objectId) ?? 0) === 0) {
        detached.add(change.before.objectId);
      }
    }
  }
  return detached;
}

function pointerStatus(
  variableName: string,
  current: ValueSnapshot,
  frameDiff: FrameDiff | null
): LinkedListPointerVisual["status"] {
  const change = frameDiff?.variables.find((item) => item.name === variableName);
  if (!change) {
    return "unchanged";
  }
  if (change.kind === "added") {
    return "added";
  }
  if (change.kind === "removed") {
    return "removed";
  }
  if (change.kind === "changed") {
    return isReference(change.before) && isReference(change.after) &&
        !valueSnapshotsEqual(change.before, change.after)
      ? "moved"
      : isReference(current)
        ? "added"
        : "removed";
  }
  return "unchanged";
}

function buildPointers(
  runtime: RuntimeState,
  candidates: Map<ObjectId, ObjectSnapshot>,
  frameDiff: FrameDiff | null
): LinkedListPointerVisual[] {
  const frame = activeFrame(runtime);
  if (!frame) {
    return [];
  }

  const pointers: LinkedListPointerVisual[] = [];
  for (const [variableName, snapshot] of Object.entries(frame.locals).sort(([left], [right]) => left.localeCompare(right))) {
    if (!isReference(snapshot) || !candidates.has(snapshot.objectId)) {
      continue;
    }
    pointers.push({
      variableName,
      objectId: snapshot.objectId,
      status: pointerStatus(variableName, snapshot, frameDiff)
    });
  }

  for (const change of frameDiff?.variables ?? []) {
    if (change.kind !== "removed" || !isReference(change.before) || !candidates.has(change.before.objectId)) {
      continue;
    }
    if (pointers.some((pointer) => pointer.variableName === change.name)) {
      continue;
    }
    pointers.push({ variableName: change.name, objectId: null, status: "removed" });
  }

  return pointers.sort((left, right) =>
    left.variableName.localeCompare(right.variableName) ||
    (left.objectId ?? "").localeCompare(right.objectId ?? "")
  );
}

export function buildLinkedListVisuals(
  runtime: RuntimeState,
  frameDiff: FrameDiff | null,
  objectDiff: ObjectDiff | null
): LinkedListVisualModel[] {
  const topology = runtime.objectTopology;
  const candidates = new Map(
    [...topology.objects.entries()]
      .filter(([, object]) => isStructuralObject(object))
  );
  if (candidates.size === 0) {
    return [];
  }

  const nextTargets = new Map<ObjectId, ObjectId | null>();
  for (const [objectId, object] of candidates) {
    const next = object.attributes.next;
    nextTargets.set(objectId, isReference(next) ? next.objectId : null);
  }

  const changes = attributeChangesByObject(objectDiff ?? EMPTY_OBJECT_DIFF);
  const detached = detachedObjectIds(candidates, nextTargets, objectDiff ?? EMPTY_OBJECT_DIFF);
  const nodes = sortedObjectIds(candidates).map((objectId): LinkedListNodeVisual => {
    const object = candidates.get(objectId)!;
    const objectChanges = changes.get(objectId) ?? [];
    const nextChange = objectChanges.find((change) => change.attribute === "next");
    const status = (objectDiff?.addedObjectIds.includes(objectId) ? "added" :
      detached.has(objectId) ? "detached" :
      objectChanges.length > 0 ? "changed" : "unchanged") as LinkedListNodeVisual["status"];
    return {
      objectId,
      className: object.className,
      label: nodeLabel(object),
      nextObjectId: nextTargets.get(objectId) ?? null,
      status,
      nextStatus: nextChange?.kind ?? "unchanged"
    };
  });
  const { components } = componentData(candidates, nextTargets);
  const visualId = `linked_list:${nodes[0]!.objectId}`;
  return [{
    kind: "linked_list",
    visualId,
    nodes,
    components,
    pointers: buildPointers(runtime, candidates, frameDiff),
    cyclic: containsCycle(candidates, nextTargets),
    truncated: topology.truncated || [...nextTargets.values()].some(
      (target) => target !== null && !candidates.has(target)
    )
  }];
}
