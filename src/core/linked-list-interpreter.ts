import type { RuntimeState } from "./runtime-state";
import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type {
  ObjectAttributeMutation,
  ReferenceMutation,
  RuntimeMutation
} from "./runtime-mutation";
import { cloneValueSnapshot } from "./value-snapshot";

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

function detachedObjectIds(
  candidates: Map<ObjectId, ObjectSnapshot>,
  nextTargets: Map<ObjectId, ObjectId | null>,
  mutations: RuntimeMutation[]
): Set<ObjectId> {
  const incoming = new Map<ObjectId, number>();
  for (const target of nextTargets.values()) {
    if (target !== null && candidates.has(target)) {
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }

  const detached = new Set<ObjectId>();
  const previousTargets = mutations
    .filter((mutation): mutation is ReferenceMutation =>
      mutation.kind === "reference" &&
      mutation.owner.scope === "object_attribute" &&
      mutation.owner.attribute === "next" &&
      mutation.beforeObjectId !== null &&
      mutation.beforeObjectId !== mutation.afterObjectId
    )
    .map((mutation) => mutation.beforeObjectId!);

  for (const objectId of previousTargets) {
    if (candidates.has(objectId) && (incoming.get(objectId) ?? 0) === 0) {
      detached.add(objectId);
    }
  }
  return detached;
}

function localReferenceMutation(
  mutations: RuntimeMutation[],
  frameId: number,
  variableName: string
): ReferenceMutation | undefined {
  return mutations.find((mutation): mutation is ReferenceMutation =>
    mutation.kind === "reference" &&
    mutation.owner.scope === "local" &&
    mutation.owner.frameId === frameId &&
    mutation.owner.variableName === variableName
  );
}

function pointerStatus(
  variableName: string,
  frameId: number,
  mutations: RuntimeMutation[]
): LinkedListPointerVisual["status"] {
  const mutation = localReferenceMutation(mutations, frameId, variableName);
  if (!mutation) {
    return "unchanged";
  }
  switch (mutation.action) {
    case "bound":
      return "added";
    case "unbound":
      return "removed";
    case "redirected":
      return "moved";
  }
}

function buildPointers(
  runtime: RuntimeState,
  candidates: Map<ObjectId, ObjectSnapshot>,
  mutations: RuntimeMutation[]
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
      status: pointerStatus(variableName, frame.frameId, mutations)
    });
  }

  for (const mutation of mutations) {
    if (mutation.kind !== "reference" || mutation.owner.scope !== "local") {
      continue;
    }
    if (
      mutation.owner.frameId !== frame.frameId ||
      mutation.action !== "unbound" ||
      mutation.beforeObjectId === null ||
      !candidates.has(mutation.beforeObjectId)
    ) {
      continue;
    }
    const variableName = mutation.owner.variableName;
    if (pointers.some((pointer) => pointer.variableName === variableName)) {
      continue;
    }
    pointers.push({
      variableName,
      objectId: null,
      status: "removed"
    });
  }

  return pointers.sort((left, right) =>
    left.variableName.localeCompare(right.variableName) ||
    (left.objectId ?? "").localeCompare(right.objectId ?? "")
  );
}

function objectAttributeMutation(
  mutations: RuntimeMutation[],
  objectId: ObjectId,
  attribute: string
): ReferenceMutation | ObjectAttributeMutation | undefined {
  return mutations.find((mutation): mutation is ReferenceMutation | ObjectAttributeMutation => {
    if (mutation.kind === "reference") {
      return mutation.owner.scope === "object_attribute" &&
        mutation.owner.objectId === objectId &&
        mutation.owner.attribute === attribute;
    }
    return mutation.kind === "object_attribute" &&
      mutation.objectId === objectId &&
      mutation.attribute === attribute;
  });
}

function nextStatus(
  mutation: RuntimeMutation | undefined
): LinkedListNodeVisual["nextStatus"] {
  if (!mutation) {
    return "unchanged";
  }
  if (mutation.kind === "reference") {
    switch (mutation.action) {
      case "bound":
        return "added";
      case "unbound":
        return "removed";
      case "redirected":
        return "changed";
    }
  }
  if (mutation.kind === "object_attribute") {
    return mutation.action;
  }
  return "unchanged";
}

function objectWasAdded(
  mutations: RuntimeMutation[],
  objectId: ObjectId
): boolean {
  return mutations.some((mutation) =>
    mutation.kind === "object_visibility" &&
    mutation.objectId === objectId &&
    mutation.action === "appeared"
  );
}

function objectWasChanged(
  mutations: RuntimeMutation[],
  objectId: ObjectId
): boolean {
  return mutations.some((mutation) => {
    if (mutation.kind === "reference") {
      return mutation.owner.scope === "object_attribute" &&
        mutation.owner.objectId === objectId;
    }
    return mutation.kind === "object_attribute" && mutation.objectId === objectId;
  });
}

export function buildLinkedListVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
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

  const detached = detachedObjectIds(candidates, nextTargets, mutations);
  const nodes = sortedObjectIds(candidates).map((objectId): LinkedListNodeVisual => {
    const object = candidates.get(objectId)!;
    const status = (objectWasAdded(mutations, objectId) ? "added" :
      detached.has(objectId) ? "detached" :
      objectWasChanged(mutations, objectId) ? "changed" : "unchanged") as LinkedListNodeVisual["status"];
    return {
      objectId,
      className: object.className,
      label: nodeLabel(object),
      nextObjectId: nextTargets.get(objectId) ?? null,
      status,
      nextStatus: nextStatus(objectAttributeMutation(mutations, objectId, "next"))
    };
  });
  const { components } = componentData(candidates, nextTargets);
  const visualId = `linked_list:${nodes[0]!.objectId}`;
  return [{
    kind: "linked_list",
    visualId,
    nodes,
    components,
    pointers: buildPointers(runtime, candidates, mutations),
    cyclic: containsCycle(candidates, nextTargets),
    truncated: topology.truncated || [...nextTargets.values()].some(
      (target) => target !== null && !candidates.has(target)
    )
  }];
}
