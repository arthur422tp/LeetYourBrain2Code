import type { ObjectId, ObjectSnapshot, ValueSnapshot } from "../shared/trace-types";
import type {
  ObjectAttributeMutation,
  ReferenceMutation,
  RuntimeMutation
} from "./runtime-mutation";
import type { RuntimeState } from "./runtime-state";
import { cloneValueSnapshot } from "./value-snapshot";

export type TreeTargetKind = "none" | "tree_node" | "external" | "unresolved";

export interface TreeNodeVisual {
  objectId: ObjectId;
  className: "TreeNode";
  label: ValueSnapshot | null;
  leftObjectId: ObjectId | null;
  rightObjectId: ObjectId | null;
  leftTargetKind: TreeTargetKind;
  rightTargetKind: TreeTargetKind;
  status: "unchanged" | "added" | "changed" | "detached";
  valueStatus: "unchanged" | "changed";
  leftStatus: "unchanged" | "added" | "removed" | "changed";
  rightStatus: "unchanged" | "added" | "removed" | "changed";
}

export interface TreePointerVisual {
  variableName: string;
  objectId: ObjectId | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export interface TreeComponent {
  componentId: string;
  nodeIds: ObjectId[];
  entryNodeIds: ObjectId[];
  pointerCount: number;
  cyclic: boolean;
  sharedChildNodeIds: ObjectId[];
  role: "main" | "detached";
}

export interface TreeVisualModel {
  kind: "tree";
  visualId: "tree:TreeNode";
  nodes: TreeNodeVisual[];
  components: TreeComponent[];
  pointers: TreePointerVisual[];
  truncated: boolean;
}

function isReference(
  value: ValueSnapshot | undefined
): value is Extract<ValueSnapshot, { type: "reference" }> {
  return value?.type === "reference";
}

function isNone(value: ValueSnapshot | undefined): boolean {
  return value?.type === "none";
}

function isTreeNodeCandidate(object: ObjectSnapshot): boolean {
  const left = object.attributes.left;
  const right = object.attributes.right;
  return object.className === "TreeNode" &&
    left !== undefined && right !== undefined &&
    (isNone(left) || isReference(left)) &&
    (isNone(right) || isReference(right));
}

function classifyTarget(
  value: ValueSnapshot,
  allObjects: Map<ObjectId, ObjectSnapshot>,
  candidates: Map<ObjectId, ObjectSnapshot>
): { objectId: ObjectId | null; kind: TreeTargetKind } {
  if (value.type === "none") {
    return { objectId: null, kind: "none" };
  }
  const objectId = (value as Extract<ValueSnapshot, { type: "reference" }>).objectId;
  if (candidates.has(objectId)) {
    return { objectId, kind: "tree_node" };
  }
  if (allObjects.has(objectId)) {
    return { objectId, kind: "external" };
  }
  return { objectId, kind: "unresolved" };
}

function sortedObjectIds(objects: Map<ObjectId, ObjectSnapshot>): ObjectId[] {
  return [...objects.keys()].sort((left, right) => left.localeCompare(right));
}

type TreeTargets = Map<ObjectId, {
  left: { objectId: ObjectId | null; kind: TreeTargetKind };
  right: { objectId: ObjectId | null; kind: TreeTargetKind };
}>;

function buildTargets(
  candidates: Map<ObjectId, ObjectSnapshot>,
  allObjects: Map<ObjectId, ObjectSnapshot>
): TreeTargets {
  const targets: TreeTargets = new Map();
  for (const objectId of sortedObjectIds(candidates)) {
    const object = candidates.get(objectId)!;
    targets.set(objectId, {
      left: classifyTarget(object.attributes.left!, allObjects, candidates),
      right: classifyTarget(object.attributes.right!, allObjects, candidates)
    });
  }
  return targets;
}

function internalTargets(targets: TreeTargets): Map<ObjectId, ObjectId[]> {
  const result = new Map<ObjectId, ObjectId[]>();
  for (const [objectId, target] of targets) {
    result.set(objectId, [target.left, target.right]
      .filter((edge): edge is { objectId: ObjectId; kind: "tree_node" } =>
        edge.kind === "tree_node" && edge.objectId !== null
      )
      .map((edge) => edge.objectId));
  }
  return result;
}

function containsCycle(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: Map<ObjectId, ObjectId[]>
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
    for (const targetId of [...(targets.get(objectId) ?? [])].sort((left, right) => left.localeCompare(right))) {
      if (visit(targetId)) {
        return true;
      }
    }
    visiting.delete(objectId);
    visited.add(objectId);
    return false;
  };

  return sortedObjectIds(candidates).some((objectId) => visit(objectId));
}

function componentData(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: TreeTargets
): { components: Array<Omit<TreeComponent, "role" | "pointerCount">>; incoming: Map<ObjectId, number> } {
  const adjacency = new Map<ObjectId, Set<ObjectId>>();
  const incoming = new Map<ObjectId, number>();
  const directed = internalTargets(targets);

  for (const objectId of candidates.keys()) {
    adjacency.set(objectId, new Set());
    incoming.set(objectId, 0);
  }

  for (const [objectId, targetIds] of directed) {
    for (const targetId of targetIds) {
      adjacency.get(objectId)!.add(targetId);
      adjacency.get(targetId)!.add(objectId);
      incoming.set(targetId, (incoming.get(targetId) ?? 0) + 1);
    }
  }

  const visited = new Set<ObjectId>();
  const components: Array<Omit<TreeComponent, "role" | "pointerCount">> = [];
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
      for (const neighbor of [...adjacency.get(current)!].sort((left, right) => left.localeCompare(right))) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    nodeIds.sort((left, right) => left.localeCompare(right));
    const componentNodeIds = new Set(nodeIds);
    components.push({
      componentId: `tree-component:${nodeIds[0]!}`,
      nodeIds,
      entryNodeIds: nodeIds.filter((objectId) => incoming.get(objectId) === 0),
      cyclic: containsCycle(
        new Map(nodeIds.map((objectId) => [objectId, candidates.get(objectId)!])),
        new Map(nodeIds.map((objectId) => [
          objectId,
          (directed.get(objectId) ?? []).filter((targetId) => componentNodeIds.has(targetId))
        ]))
      ),
      sharedChildNodeIds: nodeIds.filter((objectId) => (incoming.get(objectId) ?? 0) > 1)
    });
  }

  components.sort((left, right) => left.componentId.localeCompare(right.componentId));
  return { components, incoming };
}

function activeFrame(runtime: RuntimeState) {
  return runtime.activeFrameId === null
    ? undefined
    : runtime.frames.get(runtime.activeFrameId);
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
  mutation: ReferenceMutation | undefined
): TreePointerVisual["status"] {
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
): TreePointerVisual[] {
  const frame = activeFrame(runtime);
  if (!frame) {
    return [];
  }
  const pointers: TreePointerVisual[] = Object.entries(frame.locals)
    .filter(([, value]) => isReference(value) && candidates.has(value.objectId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variableName, value]) => ({
      variableName,
      objectId: (value as Extract<ValueSnapshot, { type: "reference" }>).objectId,
      status: pointerStatus(localReferenceMutation(mutations, frame.frameId, variableName))
    }));

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

function fieldStatus(
  mutation: ReferenceMutation | ObjectAttributeMutation | undefined
): TreeNodeVisual["leftStatus"] {
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
  return mutation.action;
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

function directlyDetachedObjectIds(
  candidates: Map<ObjectId, ObjectSnapshot>,
  targets: TreeTargets,
  mutations: RuntimeMutation[]
): Set<ObjectId> {
  const incoming = new Map<ObjectId, number>();
  for (const target of internalTargets(targets).values()) {
    for (const objectId of target) {
      incoming.set(objectId, (incoming.get(objectId) ?? 0) + 1);
    }
  }

  const detached = new Set<ObjectId>();
  for (const mutation of mutations) {
    if (
      mutation.kind !== "reference" ||
      mutation.owner.scope !== "object_attribute" ||
      (mutation.owner.attribute !== "left" && mutation.owner.attribute !== "right") ||
      (mutation.action !== "unbound" && mutation.action !== "redirected") ||
      mutation.beforeObjectId === null ||
      mutation.beforeObjectId === mutation.afterObjectId
    ) {
      continue;
    }
    if (candidates.has(mutation.beforeObjectId) && (incoming.get(mutation.beforeObjectId) ?? 0) === 0) {
      detached.add(mutation.beforeObjectId);
    }
  }
  return detached;
}

function rankComponents(
  components: Array<Omit<TreeComponent, "role" | "pointerCount">>,
  pointers: TreePointerVisual[]
): TreeComponent[] {
  const componentByNode = new Map<ObjectId, string>();
  for (const component of components) {
    for (const nodeId of component.nodeIds) {
      componentByNode.set(nodeId, component.componentId);
    }
  }
  const pointerCounts = new Map<string, number>();
  for (const pointer of pointers) {
    if (pointer.objectId === null) {
      continue;
    }
    const componentId = componentByNode.get(pointer.objectId);
    if (componentId) {
      pointerCounts.set(componentId, (pointerCounts.get(componentId) ?? 0) + 1);
    }
  }

  const ranked = components.map((component): TreeComponent => ({
    ...component,
    pointerCount: pointerCounts.get(component.componentId) ?? 0,
    role: "detached"
  })).sort((left, right) =>
    right.pointerCount - left.pointerCount ||
    right.nodeIds.length - left.nodeIds.length ||
    left.componentId.localeCompare(right.componentId)
  );
  const mainId = ranked[0]?.componentId ?? null;
  return ranked
    .map((component): TreeComponent => ({
      ...component,
      role: component.componentId === mainId ? "main" : "detached"
    }))
    .sort((left, right) =>
      (left.role === "main" ? -1 : 1) - (right.role === "main" ? -1 : 1) ||
      left.componentId.localeCompare(right.componentId)
    );
}

export function buildTreeVisuals(
  runtime: RuntimeState,
  mutations: RuntimeMutation[]
): TreeVisualModel[] {
  const allObjects = runtime.objectTopology.objects;
  const candidates = new Map(
    [...allObjects.entries()]
      .filter(([, object]) => isTreeNodeCandidate(object))
  );
  if (candidates.size === 0) {
    return [];
  }

  const targets = buildTargets(candidates, allObjects);
  const detached = directlyDetachedObjectIds(candidates, targets, mutations);
  const nodes = sortedObjectIds(candidates).map((objectId): TreeNodeVisual => {
    const object = candidates.get(objectId)!;
    const target = targets.get(objectId)!;
    const valueStatus = objectAttributeMutation(mutations, objectId, "val")
      ? "changed"
      : "unchanged";
    const leftStatus = fieldStatus(objectAttributeMutation(mutations, objectId, "left"));
    const rightStatus = fieldStatus(objectAttributeMutation(mutations, objectId, "right"));
    return {
      objectId,
      className: "TreeNode",
      label: object.attributes.val === undefined
        ? null
        : cloneValueSnapshot(object.attributes.val),
      leftObjectId: target.left.objectId,
      rightObjectId: target.right.objectId,
      leftTargetKind: target.left.kind,
      rightTargetKind: target.right.kind,
      status: objectWasAdded(mutations, objectId)
        ? "added"
        : detached.has(objectId)
          ? "detached"
          : objectWasChanged(mutations, objectId)
            ? "changed"
            : "unchanged",
      valueStatus,
      leftStatus,
      rightStatus
    };
  });
  const pointers = buildPointers(runtime, candidates, mutations);
  const { components } = componentData(candidates, targets);
  return [{
    kind: "tree",
    visualId: "tree:TreeNode",
    nodes,
    components: rankComponents(components, pointers),
    pointers,
    truncated: runtime.objectTopology.truncated
  }];
}
